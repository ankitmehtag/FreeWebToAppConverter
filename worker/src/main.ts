import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import { removeAllBuildContainers, runContainer } from './container';
import { createLogSink } from './logs';
import { assertImageMatches } from './image';
import { startWorker } from './queue';
import { createNotifier } from './notify';
import { reap } from './reaper';
import { requireEnv, storageFromEnv } from './env';

const REAP_INTERVAL_MS = 60 * 1000;

const image = requireEnv('BUILDER_IMAGE');
const timeoutMs = Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60 * 1000);
const workRoot = process.env.WORK_ROOT ?? join(tmpdir(), 'sitetoapk-builds');

await assertImageMatches(image);

const mongo = await new MongoClient(requireEnv('MONGO_URL')).connect();
const builds = mongo.db().collection('builds');
const apps = mongo.db().collection('apps');
const logs = createLogSink(new Redis(requireEnv('REDIS_URL')), mongo.db().collection('buildLogs'));

const mailKey = process.env.RESEND_API_KEY;
const notify = mailKey
  ? createNotifier({ users: mongo.db().collection('users'), apiKey: mailKey, from: requireEnv('MAIL_FROM'), appUrl: requireEnv('APP_URL') })
  : undefined;

const reaperDeps = { builds, timeoutMs, workRoot };
const leftovers = await removeAllBuildContainers();
if (leftovers) console.log(`Removed ${leftovers} build container(s) left by a previous worker`);
await reap(reaperDeps);
setInterval(() => void reap(reaperDeps).catch((error) => console.error('Reaper failed', error)), REAP_INTERVAL_MS);

const worker = startWorker(
  {
    builds,
    apps,
    logs,
    notify,
    run: runContainer,
    image,
    timeoutMs,
    workRoot,
    storage: storageFromEnv(),
    signing: {
      keystorePath: requireEnv('KEYSTORE_PATH'),
      storePassword: requireEnv('KEYSTORE_PASSWORD'),
      keyPassword: requireEnv('KEY_PASSWORD'),
      keyAlias: requireEnv('KEY_ALIAS'),
      signerSha256: requireEnv('SIGNER_SHA256'),
    },
  },
  { connection: { url: requireEnv('REDIS_URL') }, concurrency: Number(process.env.BUILD_CONCURRENCY ?? 1) },
);
worker.on('failed', (job, error) => console.error(`Build ${job?.data.buildId} failed: ${error.message}`));
console.log(`Worker ready, image ${image}`);
