// Builds the sample app with a builder image before it is rolled out, and fails if anything is wrong.
// Usage: verify-image.ts <image>   (with the worker's signing settings and MONGO_URL)
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { appConfigSchema } from '@sitetoapk/shared';
import { MongoClient, ObjectId } from 'mongodb';
import { parseKeyring, prepareKeystores } from '@sitetoapk/shared/keystore';
import { processBuild } from '../src/build';
import { createBuild } from '../src/builds';
import { runContainer } from '../src/container';
import { requireEnv } from '../src/env';
import { assertImageMatches } from '../src/image';
import type { Storage } from '../src/storage';

const [image] = process.argv.slice(2);
if (!image) {
  console.error('Usage: verify-image.ts <image>');
  process.exit(1);
}

const fail = (message: string) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

await assertImageMatches(image).catch((error: Error) => fail(error.message));
console.log(`Image ${image} matches android-template/version.json`);

const work = await mkdtemp(join(tmpdir(), 'verify-image-'));
const config = appConfigSchema.parse(JSON.parse(await readFile(new URL('../../android-template/sample/assets/app_config.json', import.meta.url), 'utf8')));
const iconPath = join(work, 'icon.png');
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0e7c66' } }).png().toFile(iconPath);

// Keeps the APK in the temp folder: checking an image must not touch the real bucket.
const kept = join(work, 'app.apk');
const storage: Storage = {
  put: async (_key, path, kind) => {
    const target = kind === 'aab' ? `${kept}.aab` : kept;
    await copyFile(path, target);
    return (await stat(target)).size;
  },
  download: async () => undefined,
  signedLink: async () => kept,
  remove: async () => undefined,
  applyLifecycle: async () => undefined,
  readLifecycle: async () => [],
};

const mongo = await new MongoClient(requireEnv('MONGO_URL')).connect();
const builds = mongo.db().collection('verifyImageBuilds');
const id = randomUUID();
try {
  await createBuild(builds, { _id: id, config, iconPath, plan: 'free', versionCode: 1, versionName: '1.0' });
  console.log('Building the sample app, which takes a few minutes');
  await processBuild(
    {
      builds,
      storage,
      run: runContainer,
      image,
      timeoutMs: Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60 * 1000),
      workRoot: join(work, 'builds'),
      signing: {
        keystorePath: requireEnv('KEYSTORE_PATH'),
        storePassword: requireEnv('KEYSTORE_PASSWORD'),
        keyPassword: requireEnv('KEY_PASSWORD'),
        keyAlias: requireEnv('KEY_ALIAS'),
        signerSha256: requireEnv('SIGNER_SHA256'),
      },
    },
    id,
    { attemptsMade: 0, attempts: 1 },
  ).catch(() => undefined);

  const build = await builds.findOne({ _id: id as never });
  if (build?.status === 'success') {
    console.log(`PASS: signed by the expected key, package and version checked, ${build.artifactBytes} bytes, SHA-256 ${build.sha256}`);
  } else {
    // Not process.exit, so the clean-up below still runs.
    console.error(`FAIL: sample build ${build?.status ?? 'missing'}: ${build?.error ?? 'no reason recorded'}`);
    process.exitCode = 1;
  }

  // The same sample as a Premium app: the image must make a key, build an APK and an AAB, and check both.
  if (process.exitCode !== 1) {
    const scratch = mongo.db('verify_image_premium');
    const appId = new ObjectId();
    const premiumId = randomUUID();
    try {
      await scratch.collection('apps').insertOne({ _id: appId, plan: 'premium' });
      await createBuild(builds, { _id: premiumId, config, iconPath, plan: 'premium', versionCode: 1, versionName: '1.0', appId });
      console.log('Building the sample app as Premium, with its own key and a bundle');
      await processBuild(
        {
          builds,
          apps: scratch.collection('apps'),
          keystores: await prepareKeystores(scratch),
          ring: parseKeyring(`1:${randomBytes(32).toString('base64')}`),
          storage,
          run: runContainer,
          image,
          timeoutMs: Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60 * 1000),
          workRoot: join(work, 'builds-premium'),
          signing: {
            keystorePath: requireEnv('KEYSTORE_PATH'),
            storePassword: requireEnv('KEYSTORE_PASSWORD'),
            keyPassword: requireEnv('KEY_PASSWORD'),
            keyAlias: requireEnv('KEY_ALIAS'),
            signerSha256: requireEnv('SIGNER_SHA256'),
          },
        },
        premiumId,
        { attemptsMade: 0, attempts: 1 },
      ).catch(() => undefined);
      const premium = await builds.findOne({ _id: premiumId as never });
      if (premium?.status === 'success' && premium.aabKey && premium.signerSha256 && premium.signerSha256 !== process.env.SIGNER_SHA256) {
        console.log(`PASS: Premium build made its own key ${premium.signerSha256.slice(0, 23)}…, an APK of ${premium.artifactBytes} bytes and an AAB of ${premium.aabBytes} bytes`);
      } else {
        console.error(`FAIL: Premium sample build ${premium?.status ?? 'missing'}: ${premium?.error ?? 'no reason recorded'}`);
        process.exitCode = 1;
      }
    } finally {
      await builds.deleteMany({ _id: premiumId as never });
      await scratch.dropDatabase();
    }
  }
} finally {
  await builds.deleteMany({ _id: id as never });
  await mongo.close();
  await rm(work, { recursive: true, force: true });
}
