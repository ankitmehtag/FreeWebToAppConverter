import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseKeyring, prepareKeystores, readKeystore } from '@sitetoapk/shared/keystore';
import { processBuild, type BuildDeps, type Run } from '../src/build';
import { createBuild } from '../src/builds';
import { createLogSink } from '../src/logs';
import { KEYGEN_ENTRYPOINT } from '../src/keygen';
import type { Storage } from '../src/storage';
import { config, iconFile, tempFile } from './helpers';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const db = mongo.db('sitetoapk_test_premium');
const builds = db.collection('builds');
const apps = db.collection('apps');
const buildLogs = db.collection('buildLogs');
const redis = new Redis('redis://127.0.0.1:6379');
const keystores = await prepareKeystores(db);
const ring = parseKeyring(`1:${randomBytes(32).toString('base64')}`);

const apk = Buffer.alloc(200 * 1024, 7);
const aab = Buffer.alloc(200 * 1024, 9);
const SHARED = 'c5'.repeat(32);
const SHA1 = Array.from({ length: 20 }, (_, i) => (i + 1).toString(16).padStart(2, '0').toUpperCase()).join(':');
const SHA256 = Array.from({ length: 32 }, (_, i) => (i + 65).toString(16).toUpperCase()).join(':');
const OWN_HEX = SHA256.replaceAll(':', '').toLowerCase();

type Seen = { keygen: number; compileArgs: string[][]; verifies: number; passwords: string[]; logged: string[] };
let seen: Seen;
// What each compile was asked for, so that verify can answer for the same build.
const compiled = new Map<string, string[]>();

const verifyFacts = (signer: string, bundle: boolean, versionCode: string, versionName: string) =>
  `package: name='${config.packageName}' versionCode='${versionCode}' versionName='${versionName}'\nSigner #1 certificate SHA-256 digest: ${signer}` +
  (bundle ? `\nAAB SHA256: ${SHA256}\nAAB valid` : '');

/** Stands in for Docker: keygen makes a key, compile writes the files, verify prints what the real one would. */
const fakeRun = (options: { bundle?: boolean; signer?: string } = {}): Run => async (opts) => {
  if (opts.entrypoint === KEYGEN_ENTRYPOINT) {
    seen.keygen += 1;
    seen.passwords.push(readFileSync(join(opts.secretsDir, 'store.pass'), 'utf8'));
    writeFileSync(join(opts.outputDir, 'key.jks'), Buffer.from(`JKS-${randomUUID()}`));
    return { code: 0, timedOut: false, log: `\tSHA1: ${SHA1}\n\tSHA256: ${SHA256}` };
  }
  if (opts.entrypoint) {
    seen.verifies += 1;
    const args = compiled.get(opts.buildId.replace(/-verify$/, '')) ?? [];
    const premium = args.includes('-PbuildBundle=true');
    const versionCode = args.find((arg) => arg.startsWith('-PversionCode='))?.split('=')[1] ?? '1';
    const versionName = args.find((arg) => arg.startsWith('-PversionName='))?.split('=')[1] ?? '1.0';
    return { code: 0, timedOut: false, log: verifyFacts(options.signer ?? (premium ? OWN_HEX : SHARED), options.bundle ?? premium, versionCode, versionName) };
  }
  seen.compileArgs.push(opts.args);
  compiled.set(opts.buildId, opts.args);
  writeFileSync(join(opts.outputDir, 'app-release.apk'), apk);
  if (opts.args.includes('-PbuildBundle=true')) writeFileSync(join(opts.outputDir, 'app-release.aab'), aab);
  ['compiled'].forEach((line) => opts.onLine?.(line));
  return { code: 0, timedOut: false, log: 'compiled' };
};

let uploads: { key: string; kind?: string }[] = [];
const storage: Storage = {
  put: async (key: string, path: string, kind?: string) => {
    uploads.push({ key, kind });
    return readFileSync(path).length;
  },
  download: async () => undefined,
  signedLink: async () => '',
  remove: async () => undefined,
  applyLifecycle: async () => undefined,
  readLifecycle: async () => [],
} as unknown as Storage;

const depsFor = (run: Run): BuildDeps => ({
  builds,
  apps,
  run,
  image: 'sitetoapk-builder:test',
  timeoutMs: 1000,
  workRoot: mkdtempSync(join(tmpdir(), 'f13-work-')),
  storage,
  logs: createLogSink(redis, buildLogs),
  keystores,
  ring,
  signing: { keystorePath: tempFile('shared.jks', 'shared'), storePassword: 'SHARED_STORE', keyPassword: 'SHARED_KEY', keyAlias: 'shared', signerSha256: SHARED },
});

/** An app with the given plan, and a build for it that asks for `asked`. */
const startBuild = async (plan: unknown, asked: 'free' | 'premium' = 'premium') => {
  const appId = new ObjectId();
  const ownerId = new ObjectId();
  await apps.insertOne({ _id: appId, ownerId, ...(plan === undefined ? {} : { plan }) });
  const id = await createBuild(builds, { _id: randomUUID(), config, iconPath: await iconFile(), plan: asked, versionCode: 1, versionName: '1.0', appId, ownerId });
  return { id, appId, ownerId };
};
const load = (id: string) => builds.findOne({ _id: id as never });
const attempt = { attemptsMade: 0, attempts: 3 };

beforeEach(async () => {
  seen = { keygen: 0, compileArgs: [], verifies: 0, passwords: [], logged: [] };
  uploads = [];
  await Promise.all([builds.deleteMany({}), apps.deleteMany({}), keystores.deleteMany({})]);
});
afterAll(async () => {
  await db.dropDatabase();
  redis.disconnect();
  await mongo.close();
});

describe('AC2: the first Premium build makes the app its own key', () => {
  it('creates one key, signs with it, and reuses it on the next build', async () => {
    const first = await startBuild('premium');
    const deps = depsFor(fakeRun());
    await processBuild(deps, first.id, attempt);
    expect(seen.keygen).toBe(1);
    const key = await readKeystore(keystores, ring, first.appId);
    expect(key?.sha256).toBe(SHA256);

    const second = await createBuild(builds, { _id: randomUUID(), config, iconPath: await iconFile(), plan: 'premium', versionCode: 2, versionName: '1.1', appId: first.appId, ownerId: first.ownerId });
    await processBuild(deps, second, attempt);
    expect(seen.keygen).toBe(1);
    expect(await keystores.countDocuments({ appId: first.appId })).toBe(1);
  });
});

describe('AC3: parallel Premium builds of one app end with one key', () => {
  it('keeps one key and both builds carry its certificate', async () => {
    const one = await startBuild('premium');
    const two = await createBuild(builds, { _id: randomUUID(), config, iconPath: await iconFile(), plan: 'premium', versionCode: 2, versionName: '1.0', appId: one.appId, ownerId: one.ownerId });
    const deps = depsFor(fakeRun());
    await Promise.all([processBuild(deps, one.id, attempt), processBuild(deps, two, attempt)]);
    expect(await keystores.countDocuments({ appId: one.appId })).toBe(1);
    expect((await load(one.id))?.signerSha256).toBe(SHA256);
    expect((await load(two))?.signerSha256).toBe(SHA256);
  });
});

describe('AC5: the key and its passwords stay out of arguments, logs and the artifact', () => {
  it('passes the key as files and never prints a password', async () => {
    const { id } = await startBuild('premium');
    const run = depsFor(fakeRun());
    await processBuild(run, id, attempt);
    const password = seen.passwords[0]!;
    expect(seen.compileArgs.flat().join(' ')).not.toContain(password);
    const log = JSON.stringify(await buildLogs.findOne({ _id: id as never }));
    expect(log).not.toContain(password);
    expect(uploads.map((u) => u.key).join()).not.toMatch(/jks|key/i);
    expect(existsSync(join(run.workRoot, id))).toBe(false);
  });
});

describe('AC6, AC7: Premium makes an APK and an AAB, Free only an APK', () => {
  it('stores both Premium files with the certificate and the bundle hash', async () => {
    const { id } = await startBuild('premium');
    await processBuild(depsFor(fakeRun()), id, attempt);
    const build = await load(id);
    expect(build?.plan).toBe('premium');
    expect(build?.artifactKey).toBe(`premium/${id}.apk`);
    expect(build?.aabKey).toBe(`premium/${id}.aab`);
    expect(build?.aabSha256).toBe(createHash('sha256').update(aab).digest('hex'));
    expect(build?.signerSha1).toBe(SHA1);
    expect(build?.signerSha256).toBe(SHA256);
    expect(uploads).toEqual([{ key: `premium/${id}.apk`, kind: undefined }, { key: `premium/${id}.aab`, kind: 'aab' }]);
    expect(seen.compileArgs[0]).toContain('-PremoveWatermark=true');
  });

  it('fails the build when the bundle is invalid or signed by someone else', async () => {
    const bad = await startBuild('premium');
    await expect(processBuild(depsFor(fakeRun({ bundle: false })), bad.id, attempt)).rejects.toThrow(/bundle/i);
    expect((await load(bad.id))?.failureKind).toBe('check');
  });

  it('builds a Free app with the shared key, an APK only, and the watermark on', async () => {
    const { id } = await startBuild('free', 'free');
    await processBuild(depsFor(fakeRun()), id, attempt);
    const build = await load(id);
    expect(build?.plan).toBe('free');
    expect(build?.aabKey).toBeUndefined();
    expect(seen.keygen).toBe(0);
    expect(seen.compileArgs[0]).not.toContain('-PremoveWatermark=true');
    expect(seen.compileArgs[0]).not.toContain('-PbuildBundle=true');
  });
});

describe('AC10: the plan is read when the worker starts', () => {
  it.each([['free'], [undefined], ['gold']])('builds as Free when the app is %s though Premium was asked for', async (plan) => {
    const { id } = await startBuild(plan, 'premium');
    await processBuild(depsFor(fakeRun()), id, attempt);
    const build = await load(id);
    expect(build?.plan).toBe('free');
    expect(build?.artifactKey).toBe(`free/${id}.apk`);
    expect(seen.compileArgs[0]).not.toContain('-PremoveWatermark=true');
    expect(seen.keygen).toBe(0);
  });
});

describe('AC15: Premium builds are kept', () => {
  it('has no expiry date, and a Free build does', async () => {
    const premium = await startBuild('premium');
    const free = await startBuild('free', 'free');
    const deps = depsFor(fakeRun());
    await processBuild(deps, premium.id, attempt);
    await processBuild(deps, free.id, attempt);
    expect((await load(premium.id))?.expiresAt).toBeNull();
    expect((await load(free.id))?.expiresAt).toBeInstanceOf(Date);
  });
});

describe('Premium without a key store configured', () => {
  it('fails as an input error instead of using the shared key', async () => {
    const { id } = await startBuild('premium');
    const deps = { ...depsFor(fakeRun()), keystores: undefined, ring: undefined };
    await expect(processBuild(deps, id, attempt)).rejects.toThrow(/Premium signing/);
    expect((await load(id))?.failureKind).toBe('input');
  });
});
