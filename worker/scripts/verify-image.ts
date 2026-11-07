// Builds the sample app with a builder image before it is rolled out, and fails if anything is wrong.
// Usage: verify-image.ts <image>   (with the worker's signing settings and MONGO_URL)
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { appConfigSchema } from '@sitetoapk/shared';
import { MongoClient } from 'mongodb';
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
  put: async (_key, path) => {
    await copyFile(path, kept);
    return (await stat(kept)).size;
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
} finally {
  await builds.deleteMany({ _id: id as never });
  await mongo.close();
  await rm(work, { recursive: true, force: true });
}
