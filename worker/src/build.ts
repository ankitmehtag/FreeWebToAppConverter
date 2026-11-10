import { createHash } from 'node:crypto';
import { copyFile, chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import type { Collection } from 'mongodb';
import { setStatus, type BuildRequest, type FailureKind } from './builds';
import { containerName, removeContainer, type BuildMounts, type runContainer } from './container';
import { environmentSecrets, redactor, type LogSink } from './logs';
import { render } from './render';
import { artifactKey, FREE_RETENTION_DAYS, type Storage } from './storage';
import { ensureFirebaseApp, topicFor, type ServiceAccount } from '@sitetoapk/shared/firebase';
import type { Notifier } from './notify';
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
  /** The apps collection, so a first success can lock the package name. The build-app script has none. */
  apps?: Collection;
  /** Streams lines and statuses to viewers, and keeps the log once the build ends. */
  logs?: LogSink;
  /** Emails the owner when the build ends. Off when no mail key is set. */
  notify?: Notifier;
  /** Registers apps with push notifications. Without it, builds that ask for push fail. */
  firebase?: ServiceAccount;
};

const VERIFY_TIMEOUT_MS = 120000;
const DOCKER_FAILURE_CODES = new Set([125, 126, 127]);
// Killed for memory (137), or Gradle's daemon killed under it: the host's fault, not the app's.
const OUT_OF_MEMORY_CODE = 137;
const DAEMON_LOST = 'Gradle build daemon disappeared unexpectedly';

/** A failure a retry can't fix, with the kind the user is shown. */
class BuildFailure extends Error {
  constructor(
    readonly kind: Exclude<FailureKind, 'infra'>,
    message: string,
  ) {
    super(message);
  }
}

/** Registers the app with Firebase and returns what it needs to receive notifications. */
const firebaseFor = async (deps: BuildDeps, build: BuildRequest) => {
  if (!deps.firebase || !build.appId) throw new BuildFailure('input', 'Push notifications are not available right now');
  const client = await ensureFirebaseApp(deps.firebase, build.config.packageName);
  return { ...client, topic: topicFor(String(build.appId)) };
};

/** The icon for this build: the website's copy in storage, or the build-app script's local file. */
const iconFor = async (deps: BuildDeps, build: BuildRequest, workDir: string) => {
  if (build.iconKey) {
    const path = join(workDir, 'icon.png');
    await deps.storage.download(build.iconKey, path);
    return path;
  }
  if (build.iconPath) return build.iconPath;
  throw new BuildFailure('input', 'Invalid input: no icon');
};

const prepareSecrets = async (dir: string, signing: Signing) => {
  await mkdir(dir);
  await copyFile(signing.keystorePath, join(dir, 'key.jks'));
  await writeFile(join(dir, 'store.pass'), signing.storePassword);
  await writeFile(join(dir, 'key.pass'), signing.keyPassword);
  // The container runs as another user, and the folder lives only as long as the build.
  await chmod(dir, 0o755);
  for (const file of ['key.jks', 'store.pass', 'key.pass']) await chmod(join(dir, file), 0o644);
};

const compile = async (deps: BuildDeps, build: BuildRequest, buildId: string, workDir: string, onLine: (line: string) => void) => {
  const secretsDir = join(workDir, 'secrets');
  const outputDir = join(workDir, 'output');
  await mkdir(outputDir);
  await chmod(outputDir, 0o777);
  await prepareSecrets(secretsDir, deps.signing);

  const iconPath = await iconFor(deps, build, workDir);
  const firebase = build.config.ui.push ? await firebaseFor(deps, build) : undefined;
  const { dir, gradleArgs } = await render({ ...build, iconPath, firebase, parentDir: workDir }).catch((error: Error) => {
    throw new BuildFailure('input', `Invalid input: ${error.message}`);
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
  const result = await deps.run({ ...mounts, args, timeoutMs: deps.timeoutMs, onLine });
  if (result.timedOut) throw new BuildFailure('timeout', 'Build timed out');
  if (result.code !== null && DOCKER_FAILURE_CODES.has(result.code)) throw new Error(`Docker failed: ${result.log}`);
  if (result.code === OUT_OF_MEMORY_CODE || (result.code !== 0 && result.log.includes(DAEMON_LOST))) {
    throw new Error('Build ran out of memory');
  }
  if (result.code !== 0) throw new BuildFailure('compile', 'Build failed');
  return { mounts, outputDir };
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
    throw new BuildFailure('check', `Check failed: ${(error as Error).message}`);
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
  const { signing, logs } = deps;
  const redact = redactor([signing.storePassword, signing.keyPassword, signing.keystorePath, workDir, deps.workRoot, ...environmentSecrets()]);
  // Lines go out one after another, in the order the container wrote them.
  let sent = Promise.resolve();
  const onLine = (line: string) => {
    const text = redact(line);
    if (logs) sent = sent.then(() => logs.line(buildId, text)).catch(() => undefined);
  };
  let ended = false;
  let outcome: 'success' | 'failed' | undefined;
  const move = async (status: string, fields: Record<string, unknown> = {}) => {
    await setStatus(deps.builds, buildId, status, fields);
    ended = ['success', 'failed'].includes(status);
    if (status === 'success' || status === 'failed') outcome = status;
    await logs?.status(buildId, status, fields.failureKind as FailureKind | undefined).catch(() => undefined);
  };

  try {
    // A crashed worker leaves its container and files behind, and this retry reuses both names.
    await removeContainer(containerName(buildId));
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    await move('building', { startedAt: new Date() });

    const { mounts, outputDir } = await compile(deps, build, buildId, workDir, onLine);
    const apk = join(outputDir, 'app-release.apk');

    await move('signing');
    await verify(deps, build, mounts, apk);

    // A takedown during the build must not let it publish an APK.
    if (build.appId && (await deps.apps?.findOne({ _id: build.appId }))?.takenDown) {
      throw new BuildFailure('input', 'App taken down');
    }

    await move('uploading');
    const sha256 = createHash('sha256').update(await readFile(apk)).digest('hex');
    const key = artifactKey(build.plan, buildId);
    const artifactBytes = await deps.storage.put(key, apk);
    const expiresAt = new Date(Date.now() + FREE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    await move('success', { artifactKey: key, artifactBytes, sha256, expiresAt });
    // Only the first success sets it, so the lock records when the package name became fixed.
    if (build.appId) await deps.apps?.updateOne({ _id: build.appId, lockedAt: null }, { $set: { lockedAt: new Date() } });
  } catch (error) {
    const message = (error as Error).message;
    if (error instanceof BuildFailure) {
      await move('failed', { error: message, failureKind: error.kind });
      throw new UnrecoverableError(message);
    }
    const last = attemptsMade + 1 >= attempts;
    // Our own failures don't use up the user's daily builds.
    const failed = { error: message, failureKind: 'infra', countsTowardLimit: false };
    await move(last ? 'failed' : 'queued', last ? failed : { error: message });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await sent;
    if (ended) await logs?.finish(buildId).catch(() => undefined);
    if (outcome) await deps.notify?.(build, outcome);
  }
};
