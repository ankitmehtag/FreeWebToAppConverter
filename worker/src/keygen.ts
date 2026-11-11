import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { createKeystoreOnce, readKeystore, type Fingerprints, type KeystoreSecrets, type Keyring, type Keystores } from '@sitetoapk/shared/keystore';
import type { Run } from './build';

export const KEYGEN_ENTRYPOINT = '/opt/builder/keygen.sh';

const SHA1 = /SHA1:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){19})/;
const SHA256 = /SHA256:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){31})/;

export type OwnKey = Fingerprints & { secrets: KeystoreSecrets };

/** Makes a key inside a builder container, where `keytool` is. The passwords reach it as files only. */
const generate = async (run: Run, image: string, workDir: string, buildId: string): Promise<OwnKey> => {
  const dir = join(workDir, 'keygen');
  const secretsDir = join(dir, 'secrets');
  const outputDir = join(dir, 'output');
  const generatedDir = join(dir, 'empty');
  await rm(dir, { recursive: true, force: true });
  for (const path of [secretsDir, outputDir, generatedDir]) await mkdir(path, { recursive: true });
  // A PKCS12 key store has one password for the store and the key, so there is one here too.
  const password = randomBytes(24).toString('base64url');
  const alias = `app-${randomBytes(6).toString('hex')}`;
  await writeFile(join(secretsDir, 'store.pass'), password);
  await writeFile(join(secretsDir, 'key.pass'), password);
  await writeFile(join(secretsDir, 'alias'), alias);
  // The container runs as another user, and the folder lives only as long as the build.
  for (const path of [dir, secretsDir, generatedDir]) await chmod(path, 0o755);
  await chmod(outputDir, 0o777);
  for (const file of ['store.pass', 'key.pass', 'alias']) await chmod(join(secretsDir, file), 0o644);

  const result = await run({ buildId: `${buildId}-keygen`, image, generatedDir, secretsDir, outputDir, entrypoint: KEYGEN_ENTRYPOINT, args: [], timeoutMs: 120000 });
  const sha1 = SHA1.exec(result.log)?.[1];
  const sha256 = SHA256.exec(result.log)?.[1];
  if (result.code !== 0 || !sha1 || !sha256) throw new Error('Could not create the signing key');
  const keystore = await readFile(join(outputDir, 'key.jks'));
  await rm(dir, { recursive: true, force: true });
  return { sha1, sha256, secrets: { alias, storePassword: password, keyPassword: password, keystore } };
};

/** The app's own key. The first call makes it, and a call that lost a race uses the winner's. */
export const ownKeyFor = async (
  deps: { run: Run; image: string; keystores: Keystores; ring: Keyring },
  appId: ObjectId,
  ownerId: ObjectId | undefined,
  workDir: string,
  buildId: string,
): Promise<OwnKey> => {
  const existing = await readKeystore(deps.keystores, deps.ring, appId);
  if (existing) return existing;
  const made = await generate(deps.run, deps.image, workDir, buildId);
  await createKeystoreOnce(deps.keystores, deps.ring, appId, made.secrets, { sha1: made.sha1, sha256: made.sha256 }, ownerId);
  const winner = await readKeystore(deps.keystores, deps.ring, appId);
  if (!winner) throw new Error('The signing key was not saved');
  return winner;
};
