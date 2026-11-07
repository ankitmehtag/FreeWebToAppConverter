// Load test: 20 builds through the real queue and worker, then checks that nothing leaked or was left behind.
// Usage: load-test.ts   (with the worker's settings; it starts, kills and restarts its own worker)
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import type { AppConfig } from '@sitetoapk/shared';
import { processBuild } from '../src/build';
import { createBuild, enqueueBuild, FINAL_STATUSES, logLinesKey, QUEUE_NAME } from '../src/builds';
import { runContainer } from '../src/container';
import { requireEnv, storageFromEnv } from '../src/env';

const exec = promisify(execFile);
const COUNT = Number(process.env.LOAD_BUILDS ?? 20);
const CONCURRENCY = Number(process.env.BUILD_CONCURRENCY ?? 2);
const KILL_AFTER = Math.min(4, COUNT - 1);
const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const results: { check: string; pass: boolean; detail: string }[] = [];
const record = (check: string, pass: boolean, detail: string) => {
  results.push({ check, pass, detail });
  log(pass ? 'PASS' : 'FAIL', check, '-', detail);
};

const workRoot = await mkdtemp(join(tmpdir(), 'load-test-work-'));
const scratch = await mkdtemp(join(tmpdir(), 'load-test-'));
const iconPath = join(scratch, 'icon.png');
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0e7c66' } }).png().toFile(iconPath);

const mongo = await new MongoClient(requireEnv('MONGO_URL')).connect();
const builds = mongo.db().collection('builds');
const buildLogs = mongo.db().collection('buildLogs');
const redis = new Redis(requireEnv('REDIS_URL'));
const queue = new Queue(QUEUE_NAME, { connection: { url: requireEnv('REDIS_URL') } });
const storage = storageFromEnv();

const buildContainers = async () => {
  const { stdout } = await exec('docker', ['ps', '-a', '--filter', 'label=sitetoapk.build', '--format', '{{.Label "sitetoapk.build"}}']);
  return stdout.split('\n').filter(Boolean).map((id) => id.replace(/-verify$/, ''));
};

if ((await buildContainers()).length) throw new Error('Build containers are already running; stop them first');

// Every live line from any build, to search for secrets as well as the stored ones.
const live: string[] = [];
const listener = new Redis(requireEnv('REDIS_URL'));
listener.on('pmessage', (_pattern, _channel, message) => live.push(message));
await listener.psubscribe('build:*');

let worker: ChildProcess | null = null;
const startWorker = () => {
  // node --import tsx keeps the worker one process, so a kill reaches it directly.
  worker = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, WORK_ROOT: workRoot, BUILD_CONCURRENCY: String(CONCURRENCY) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
};

const config = (n: number): AppConfig => ({
  schemaVersion: 1,
  startUrl: 'https://example.com/',
  packageName: `com.loadtest.app${n}`,
  appName: `Load ${n}`,
  internalHosts: ['example.com', `marker-${n}.example`],
  ui: { statusBarColor: '#0F172A', orientation: 'unspecified', zoom: false, progressBar: true, pullToRefresh: true, exitDialog: true },
});

const ids: string[] = [];
const started = Date.now();
startWorker();
for (let n = 1; n <= COUNT; n += 1) {
  const id = randomUUID();
  ids.push(id);
  await enqueueBuild(builds, queue, { _id: id, config: config(n), iconPath, plan: 'free', versionCode: n, versionName: '1.0' });
}
log(`queued ${COUNT} builds, worker concurrency ${CONCURRENCY}`);

// One build run alongside the queue with a 30-second limit, which must be killed. It starts once the worker
// is taking jobs, because a starting worker removes every build container it finds, this one included.
const timeoutId = randomUUID();
await createBuild(builds, { _id: timeoutId, config: config(0), iconPath, plan: 'free', versionCode: 1, versionName: '1.0' });
const startTimeoutRun = () => processBuild(
  {
    builds,
    storage,
    run: runContainer,
    image: requireEnv('BUILDER_IMAGE'),
    timeoutMs: 30_000,
    workRoot,
    signing: {
      keystorePath: requireEnv('KEYSTORE_PATH'),
      storePassword: requireEnv('KEYSTORE_PASSWORD'),
      keyPassword: requireEnv('KEY_PASSWORD'),
      keyAlias: requireEnv('KEY_ALIAS'),
      signerSha256: requireEnv('SIGNER_SHA256'),
    },
  },
  timeoutId,
  { attemptsMade: 0, attempts: 1 },
).catch(() => undefined);

// After a crash, the dead worker's containers run on until their jobs are picked up again. Those are
// leftovers, not builds the worker chose to run, so that window is reported apart.
const RECOVERY_WINDOW_MS = 90_000;
let peak = 0;
let recoveryPeak = 0;
let killedAt = 0;
let killed = false;
let lastCount = -1;
let timeoutRun: Promise<unknown> | null = null;
const deadline = Date.now() + 3 * 60 * 60 * 1000;
for (;;) {
  const running = new Set((await buildContainers()).filter((id) => ids.includes(id))).size;
  if (killed && Date.now() - killedAt < RECOVERY_WINDOW_MS) recoveryPeak = Math.max(recoveryPeak, running);
  else peak = Math.max(peak, running);
  if (!timeoutRun && running > 0) timeoutRun = startTimeoutRun();
  const others = (await buildContainers()).filter((id) => !ids.includes(id)).length;
  if (running !== lastCount) {
    log(`build containers running: ${running} from the queue${others ? `, ${others} other` : ''}`);
    lastCount = running;
  }
  const docs = await builds.find({ _id: { $in: ids as never[] } }).toArray();
  const done = docs.filter((doc) => FINAL_STATUSES.includes(doc.status));
  const successes = docs.filter((doc) => doc.status === 'success').length;

  if (!killed && successes >= KILL_AFTER && docs.some((doc) => ['building', 'signing', 'uploading'].includes(doc.status))) {
    log(`killing the worker mid-run after ${successes} successes`);
    worker!.kill('SIGKILL');
    killed = true;
    killedAt = Date.now();
    await sleep(5000);
    startWorker();
    log('worker restarted');
  }
  if (done.length === COUNT) break;
  if (Date.now() > deadline) throw new Error('Load test ran past 3 hours');
  await sleep(2000);
}
await timeoutRun;
worker!.kill('SIGTERM');
await sleep(3000);
const elapsedMinutes = ((Date.now() - started) / 60000).toFixed(1);

// R5: concurrency and outcomes.
const docs = await builds.find({ _id: { $in: ids as never[] } }).toArray();
const statuses = docs.reduce<Record<string, number>>((count, doc) => ({ ...count, [doc.status]: (count[doc.status] ?? 0) + 1 }), {});
record('AC3 concurrency', peak <= CONCURRENCY, `peak ${peak} build containers at once, limit ${CONCURRENCY}; ${recoveryPeak} at most in the ${RECOVERY_WINDOW_MS / 1000} s after the kill, including the dead worker's leftovers`);
record('AC3 outcomes', statuses.success === COUNT, `${JSON.stringify(statuses)} in ${elapsedMinutes} minutes`);
for (const failed of docs.filter((doc) => doc.status === 'failed')) {
  const stored = await buildLogs.findOne({ _id: failed._id });
  const tail = ((stored?.lines ?? []) as { text: string }[]).slice(-25).map((line) => `    ${line.text}`).join('\n');
  log(`${failed.config.appName} failed (${failed.failureKind}): ${failed.error}\n${tail}`);
}

// R9: timeout and recovery.
const timedOut = await builds.findOne({ _id: timeoutId as never });
record('AC7 timeout kill', timedOut?.status === 'failed' && timedOut.failureKind === 'timeout', `${timedOut?.status}, ${timedOut?.failureKind}, ${timedOut?.error}`);
const stuck = docs.filter((doc) => !FINAL_STATUSES.includes(doc.status));
const retried = docs.filter((doc) => doc.history.filter((step: string) => step === 'building').length > 1);
record('AC7 recovery', killed && stuck.length === 0, `worker killed: ${killed}; ${retried.length} build(s) ran again after the kill; ${stuck.length} stuck`);

// R6: nothing left behind.
const containers = await buildContainers();
const folders = await readdir(workRoot);
const ttls = await Promise.all(ids.map((id) => redis.ttl(logLinesKey(id))));
record('AC4 containers', containers.length === 0, `${containers.length} build containers left`);
record('AC4 work folders and secrets', folders.length === 0, `${folders.length} entries left in the work root`);
record('AC4 live log lists', ttls.every((ttl) => ttl === -2 || (ttl > 0 && ttl <= 3600)), `every list expires within an hour (TTLs ${Math.min(...ttls)} to ${Math.max(...ttls)})`);

// R7: each APK holds only its own config.
const apkDir = join(scratch, 'apks');
await mkdir(apkDir);
let isolated = 0;
const mixups: string[] = [];
for (const doc of docs.filter((item) => item.status === 'success')) {
  const n = Number(doc.config.appName.replace('Load ', ''));
  const file = join(apkDir, `${n}.apk`);
  await writeFile(file, Buffer.from(await (await fetch(await storage.signedLink(doc.artifactKey, 600))).arrayBuffer()));
  const { stdout } = await exec('unzip', ['-p', file, 'assets/app_config.json']);
  const inside = JSON.parse(stdout) as AppConfig;
  const others = [...stdout.matchAll(/marker-(\d+)\.example/g)].map((match) => Number(match[1])).filter((m) => m !== n);
  if (inside.packageName === `com.loadtest.app${n}` && inside.appName === `Load ${n}` && inside.internalHosts.includes(`marker-${n}.example`) && others.length === 0) {
    isolated += 1;
  } else {
    mixups.push(`build ${n}`);
  }
}
record('AC5 isolation', isolated === COUNT && mixups.length === 0, `${isolated} of ${COUNT} APKs hold only their own config${mixups.length ? `; wrong: ${mixups.join(', ')}` : ''}`);

// R8: no secret anywhere a user or operator could read it.
const secrets = Object.fromEntries(
  ['KEYSTORE_PASSWORD', 'KEY_PASSWORD', 'KEYSTORE_PATH', 'R2_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID', 'JWT_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET']
    .filter((name) => process.env[name] && process.env[name]!.length >= 4)
    .map((name) => [name, process.env[name]!]),
);
secrets.WORK_ROOT = workRoot;
const stored = JSON.stringify(await buildLogs.find({ _id: { $in: [...ids, timeoutId] as never[] } }).toArray());
const records = JSON.stringify(await builds.find({ _id: { $in: [...ids, timeoutId] as never[] } }).toArray());
const haystacks = { 'stored logs': stored, 'build records': records, 'live lines': live.join('\n') };
const leaks = Object.entries(haystacks).flatMap(([where, text]) =>
  Object.entries(secrets).filter(([, value]) => text.includes(value)).map(([name]) => `${name} in ${where}`),
);
record('AC6 secrets', leaks.length === 0, `searched ${Object.keys(secrets).length} secrets in ${live.length} live lines, ${stored.length} bytes of stored logs and ${COUNT + 1} records${leaks.length ? `; found ${leaks.join(', ')}` : ''}`);

// R10: timings.
const minutes = (ms: number) => `${(ms / 60000).toFixed(1)} min`;
const durations = docs.filter((doc) => doc.startedAt).map((doc) => doc.updatedAt.getTime() - doc.startedAt.getTime()).sort((a, b) => a - b);
const waits = docs.filter((doc) => doc.startedAt).map((doc) => doc.startedAt.getTime() - doc.createdAt.getTime());
record(
  'AC8 timings',
  durations.length === COUNT,
  `build median ${minutes(durations[Math.floor(durations.length / 2)] ?? 0)}, slowest ${minutes(durations.at(-1) ?? 0)}, longest queue wait ${minutes(Math.max(...waits))}`,
);

// Clean up: the APKs and records were only for this test, and R2 storage costs money past its free allowance.
for (const doc of await builds.find({ _id: { $in: [...ids, timeoutId] as never[] } }).toArray()) {
  if (doc.artifactKey) await storage.remove(doc.artifactKey);
}
await builds.deleteMany({ _id: { $in: [...ids, timeoutId] as never[] } });
await buildLogs.deleteMany({ _id: { $in: [...ids, timeoutId] as never[] } });
await rm(scratch, { recursive: true, force: true });
await rm(workRoot, { recursive: true, force: true });
await listener.quit();
await redis.quit();
await queue.close();
await mongo.close();

const failed = results.filter((result) => !result.pass);
log(failed.length ? `${failed.length} check(s) failed` : 'all checks passed');
process.exitCode = failed.length ? 1 : 0;
