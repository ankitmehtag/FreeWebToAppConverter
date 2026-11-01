// Turns a config and an icon into a signed APK and a download link.
// Usage: build-app.ts <config.json> <icon.png>
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { appConfigSchema } from '@sitetoapk/shared';
import { MongoClient } from 'mongodb';
import { processBuild } from '../src/build';
import { createBuild } from '../src/builds';
import { runContainer } from '../src/container';
import { requireEnv, storageFromEnv } from '../src/env';
import { assertImageMatches } from '../src/image';
import { createDownloadLink } from '../src/links';

const [configPath, iconPath] = process.argv.slice(2);
if (!configPath || !iconPath) {
  console.error('Usage: build-app.ts <config.json> <icon.png>');
  process.exit(1);
}

const config = appConfigSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
const image = requireEnv('BUILDER_IMAGE');
await assertImageMatches(image);

const mongo = await new MongoClient(requireEnv('MONGO_URL')).connect();
const builds = mongo.db().collection('builds');
const storage = storageFromEnv();
const workRoot = process.env.WORK_ROOT ?? join(tmpdir(), 'sitetoapk-builds');
await mkdir(workRoot, { recursive: true });

const id = await createBuild(builds, {
  _id: randomUUID(), config, iconPath: resolve(iconPath), plan: 'free', versionCode: 1, versionName: '1.0',
});

console.log(`Building ${id}, which takes a few minutes`);
await processBuild(
  {
    builds,
    storage,
    run: runContainer,
    image,
    timeoutMs: Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60 * 1000),
    workRoot,
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
);

const build = await builds.findOne({ _id: id as never });
console.log(`SHA-256: ${build?.sha256}`);
console.log(await createDownloadLink({ builds, storage }, id));
await mongo.close();
