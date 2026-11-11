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
import { checkBuild, checkBundle } from './verify';
import { ownKeyFor } from './keygen';
import { planOf, type Plan } from '@sitetoapk/shared';
import { plainHex, type Keyring, type Keystores } from '@sitetoapk/shared/keystore';

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
  /** Premium apps sign with their own key, kept here and sealed with the master key. Without them, Premium builds fail. */
  keystores?: Keystores;
  ring?: Keyring;
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

const compile = async (
  deps: BuildDeps,
  build: BuildRequest,
  plan: Plan,
  signing: Signing,
  buildId: string,
  workDir: string,
  onLine: (line: string) => void,
) => {
  const secretsDir = join(workDir, 'secrets');
  const outputDir = join(workDir, 'output');
  await mkdir(outputDir);
  await chmod(outputDir, 0o777);
  await prepareSecrets(secretsDir, signing);

  const iconPath = await iconFor(deps, build, workDir);
  const firebase = build.config.ui.push ? await firebaseFor(deps, build) : undefined;
  const { dir, gradleArgs } = await render({ ...build, plan, iconPath, firebase, parentDir: workDir }).catch((error: Error) => {
    throw new BuildFailure('input', `Invalid input: ${error.message}`);
  });
  await chmod(workDir, 0o755);
  await chmod(dir, 0o755);

  const args = [
    ...gradleArgs.map((arg) => (arg.startsWith('-PgeneratedDir=') ? '-PgeneratedDir=/generated' : arg)),
    '-PkeystorePath=/secrets/key.jks',
    '-PkeystorePassFile=/secrets/store.pass',
    '-PkeyPassFile=/secrets/key.pass',
    `-PkeyAlias=${signing.keyAlias}`,
    ...(plan === 'premium' ? ['-PbuildBundle=true'] : []),
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

const verify = async (deps: BuildDeps, build: BuildRequest, plan: Plan, signing: Signing, mounts: Mounts, apk: string, aab: string) => {
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
      signerSha256: signing.signerSha256,
    });
    if (plan === 'premium') {
      const bundleBytes = (await stat(aab).catch(() => ({ size: 0 }))).size;
      checkBundle(facts.log, bundleBytes, signing.signerSha256);
    }
  } catch (error) {
    throw new BuildFailure('check', `Check failed: ${(error as Error).message}`);
  }
};

/**
 * The plan is read from the app when the build starts, not from the request, so a build asked for while an app
 * was Premium is still Free if it was moved back before the worker began. Without an app record it is Free.
 */
const planFor = async (deps: BuildDeps, build: BuildRequest): Promise<Plan> => {
  if (!build.appId || !deps.apps) return 'free';
  return planOf(await deps.apps.findOne({ _id: build.appId }));
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
  const { logs } = deps;
  const redactions = [deps.signing.storePassword, deps.signing.keyPassword, deps.signing.keystorePath, workDir, deps.workRoot, ...environmentSecrets()];
  let redact = redactor(redactions);
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
    const plan = await planFor(deps, build);
    await move('building', { startedAt: new Date(), plan });

    // Premium apps sign with their own key. Its passwords are kept out of the log like the shared key's.
    let signing = deps.signing;
    let own: Awaited<ReturnType<typeof ownKeyFor>> | undefined;
    if (plan === 'premium') {
      if (!deps.keystores || !deps.ring || !build.appId) throw new BuildFailure('input', 'Premium signing is not available right now');
      own = await ownKeyFor({ run: deps.run, image: deps.image, keystores: deps.keystores, ring: deps.ring }, build.appId, build.ownerId, workDir, buildId);
      const keystorePath = join(workDir, 'own-key.jks');
      await writeFile(keystorePath, own.secrets.keystore, { mode: 0o600 });
      signing = {
        keystorePath,
        storePassword: own.secrets.storePassword,
        keyPassword: own.secrets.keyPassword,
        keyAlias: own.secrets.alias,
        signerSha256: plainHex(own.sha256),
      };
      redact = redactor([...redactions, signing.storePassword, signing.keyPassword, keystorePath]);
    }

    const { mounts, outputDir } = await compile(deps, build, plan, signing, buildId, workDir, onLine);
    const apk = join(outputDir, 'app-release.apk');
    const aab = join(outputDir, 'app-release.aab');

    await move('signing');
    await verify(deps, build, plan, signing, mounts, apk, aab);

    // A takedown during the build must not let it publish an APK.
    if (build.appId && (await deps.apps?.findOne({ _id: build.appId }))?.takenDown) {
      throw new BuildFailure('input', 'App taken down');
    }

    await move('uploading');
    const sha256 = createHash('sha256').update(await readFile(apk)).digest('hex');
    const key = artifactKey(plan, buildId);
    const artifactBytes = await deps.storage.put(key, apk);
    // Premium files are kept while the account is active, so they have no expiry date.
    const expiresAt = plan === 'premium' ? null : new Date(Date.now() + FREE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const premiumFields: Record<string, unknown> = {};
    if (plan === 'premium' && own) {
      const aabKey = artifactKey(plan, buildId, 'aab');
      premiumFields.aabKey = aabKey;
      premiumFields.aabBytes = await deps.storage.put(aabKey, aab, 'aab');
      premiumFields.aabSha256 = createHash('sha256').update(await readFile(aab)).digest('hex');
      premiumFields.signerSha1 = own.sha1;
      premiumFields.signerSha256 = own.sha256;
    }

    await move('success', { artifactKey: key, artifactBytes, sha256, expiresAt, ...premiumFields });
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
