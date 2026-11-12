import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import { removeAllBuildContainers, runContainer } from './container';
import { createLogSink } from './logs';
import { assertImageMatches } from './image';
import { startWorker } from './queue';
import { createMailer, createNotifier } from './notify';
import { buildExpiryReminders } from './build-expiry';
import { keyUpkeep } from './key-upkeep';
import { parseKeyring, prepareKeystores } from '@sitetoapk/shared/keystore';
import { serviceAccountFromEnv } from '@sitetoapk/shared/firebase';
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

// Premium apps sign with their own key. Without the master key they cannot be built, and Free builds go on.
const ring = process.env.KEYSTORE_MASTER_KEY ? parseKeyring(process.env.KEYSTORE_MASTER_KEY) : undefined;
const keystores = await prepareKeystores(mongo.db());

const KEY_UPKEEP_INTERVAL_MS = 60 * 60 * 1000;
if (mailKey) {
  const mail = createMailer({ apiKey: mailKey, from: requireEnv('MAIL_FROM') });
  const upkeep = () =>
    keyUpkeep({ keystores, users: mongo.db().collection('users'), apps, mail, appUrl: requireEnv('APP_URL') }).catch((error) =>
      console.error('Key upkeep failed', error),
    );
  const expiry = () =>
    buildExpiryReminders({ builds, users: mongo.db().collection('users'), mail, appUrl: requireEnv('APP_URL') }).catch((error) =>
      console.error('Build expiry reminders failed', error),
    );
  void upkeep();
  void expiry();
  setInterval(() => {
    void upkeep();
    void expiry();
  }, KEY_UPKEEP_INTERVAL_MS);
}

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
    firebase: serviceAccountFromEnv(),
    keystores,
    ring,
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
