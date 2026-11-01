import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { runContainer } from './container';
import { assertImageMatches } from './image';
import { startWorker } from './queue';
import { reap } from './reaper';

const REAP_INTERVAL_MS = 60 * 1000;

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

const image = requireEnv('BUILDER_IMAGE');
const timeoutMs = Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60 * 1000);
const workRoot = process.env.WORK_ROOT ?? join(tmpdir(), 'sitetoapk-builds');

await assertImageMatches(image);

const mongo = await new MongoClient(requireEnv('MONGO_URL')).connect();
const builds = mongo.db().collection('builds');

const reaperDeps = { builds, timeoutMs, workRoot };
await reap(reaperDeps);
setInterval(() => void reap(reaperDeps).catch((error) => console.error('Reaper failed', error)), REAP_INTERVAL_MS);

const worker = startWorker(
  {
    builds,
    run: runContainer,
    image,
    timeoutMs,
    workRoot,
    artifactsDir: requireEnv('ARTIFACTS_DIR'),
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
