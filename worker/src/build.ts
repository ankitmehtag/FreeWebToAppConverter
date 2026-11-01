import { createHash } from 'node:crypto';
import { copyFile, chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import type { Collection } from 'mongodb';
import { setStatus, type BuildRequest } from './builds';
import { containerName, removeContainer, type BuildMounts, type runContainer } from './container';
import { render } from './render';
import { artifactKey, FREE_RETENTION_DAYS, type Storage } from './storage';
import { checkBuild } from './verify';

export type Run = typeof runContainer;

export type Signing = {
  keystorePath: string;
  storePassword: string;
  keyPassword: string;
  keyAlias: string;
  signerSha256: string;
};

export type BuildDeps = {
  builds: Collection;
  run: Run;
  image: string;
  timeoutMs: number;
  workRoot: string;
  storage: Storage;
  signing: Signing;
};

const VERIFY_TIMEOUT_MS = 120000;
const DOCKER_FAILURE_CODES = new Set([125, 126, 127]);

class BuildFailure extends Error {}

const prepareSecrets = async (dir: string, signing: Signing) => {
  await mkdir(dir);
  await copyFile(signing.keystorePath, join(dir, 'key.jks'));
  await writeFile(join(dir, 'store.pass'), signing.storePassword);
  await writeFile(join(dir, 'key.pass'), signing.keyPassword);
  // The container runs as another user, and the folder lives only as long as the build.
  await chmod(dir, 0o755);
  for (const file of ['key.jks', 'store.pass', 'key.pass']) await chmod(join(dir, file), 0o644);
};

const compile = async (deps: BuildDeps, build: BuildRequest, buildId: string, workDir: string) => {
  const secretsDir = join(workDir, 'secrets');
  const outputDir = join(workDir, 'output');
  await mkdir(outputDir);
  await chmod(outputDir, 0o777);
  await prepareSecrets(secretsDir, deps.signing);

  const { dir, gradleArgs } = await render({ ...build, parentDir: workDir }).catch((error: Error) => {
    throw new BuildFailure(`Invalid input: ${error.message}`);
  });
  await chmod(workDir, 0o755);
  await chmod(dir, 0o755);

  const args = [
    ...gradleArgs.map((arg) => (arg.startsWith('-PgeneratedDir=') ? '-PgeneratedDir=/generated' : arg)),
    '-PkeystorePath=/secrets/key.jks',
    '-PkeystorePassFile=/secrets/store.pass',
    '-PkeyPassFile=/secrets/key.pass',
    `-PkeyAlias=${deps.signing.keyAlias}`,
  ];
  const mounts = { generatedDir: dir, secretsDir, outputDir, image: deps.image, buildId };
  const result = await deps.run({ ...mounts, args, timeoutMs: deps.timeoutMs });
  if (result.timedOut) throw new BuildFailure('Build timed out');
  if (result.code !== null && DOCKER_FAILURE_CODES.has(result.code)) throw new Error(`Docker failed: ${result.log}`);
  if (result.code !== 0) {
    await deps.builds.updateOne({ _id: buildId as never }, { $set: { log: result.log } });
    throw new BuildFailure('Build failed');
  }
  return { mounts, outputDir, log: result.log };
};

type Mounts = BuildMounts & { image: string; buildId: string };

const verify = async (deps: BuildDeps, build: BuildRequest, mounts: Mounts, apk: string) => {
  // A second container, so that a build can't vouch for itself.
  const facts = await deps.run({
    ...mounts,
    buildId: `${mounts.buildId}-verify`,
    entrypoint: '/opt/builder/verify.sh',
    args: [],
    timeoutMs: VERIFY_TIMEOUT_MS,
  });
  const bytes = (await stat(apk).catch(() => ({ size: 0 }))).size;
  try {
    checkBuild(facts.log, bytes, {
      packageName: build.config.packageName,
      versionCode: build.versionCode,
      versionName: build.versionName,
      signerSha256: deps.signing.signerSha256,
    });
  } catch (error) {
    throw new BuildFailure(`Check failed: ${(error as Error).message}`);
  }
};

/** Runs one build. Throws UnrecoverableError when a retry could not help. */
export const processBuild = async (
  deps: BuildDeps,
  buildId: string,
  { attemptsMade, attempts }: { attemptsMade: number; attempts: number },
) => {
  const build = (await deps.builds.findOne({ _id: buildId as never })) as unknown as (BuildRequest & { status: string }) | null;
  if (!build || ['success', 'failed', 'canceled'].includes(build.status)) return;

  const workDir = join(deps.workRoot, buildId);
  try {
    // A crashed worker leaves its container and files behind, and this retry reuses both names.
    await removeContainer(containerName(buildId));
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    await setStatus(deps.builds, buildId, 'building', { startedAt: new Date() });

    const { mounts, outputDir, log } = await compile(deps, build, buildId, workDir);
    const apk = join(outputDir, 'app-release.apk');

    await setStatus(deps.builds, buildId, 'signing', { log });
    await verify(deps, build, mounts, apk);

    await setStatus(deps.builds, buildId, 'uploading');
    const sha256 = createHash('sha256').update(await readFile(apk)).digest('hex');
    const key = artifactKey(build.plan, buildId);
    const artifactBytes = await deps.storage.put(key, apk);
    const expiresAt = new Date(Date.now() + FREE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    await setStatus(deps.builds, buildId, 'success', { artifactKey: key, artifactBytes, sha256, expiresAt });
  } catch (error) {
    const message = (error as Error).message;
    if (error instanceof BuildFailure) {
      await setStatus(deps.builds, buildId, 'failed', { error: message });
      throw new UnrecoverableError(message);
    }
    const last = attemptsMade + 1 >= attempts;
    await setStatus(deps.builds, buildId, last ? 'failed' : 'queued', { error: message });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};
