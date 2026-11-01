import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { MongoClient } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processBuild, type BuildDeps, type Run } from '../src/build';
import { createBuild } from '../src/builds';
import { config, iconFile, tempFile } from './helpers';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const builds = mongo.db('sitetoapk_test').collection('builds_unit');
const SIGNER = 'c5'.repeat(32);
const apk = Buffer.alloc(200 * 1024, 7);

const facts = (packageName = config.packageName) =>
  `package: name='${packageName}' versionCode='1' versionName='1.0'\nSigner #1 certificate SHA-256 digest: ${SIGNER}`;

// Stands in for Docker: compile writes an APK, and verify prints facts.
const fakeRun = (compile: Partial<Awaited<ReturnType<Run>>> = {}, verifyFacts = facts()): Run => async (options) => {
  if (options.entrypoint) return { code: 0, timedOut: false, log: verifyFacts };
  if ((compile.code ?? 0) === 0 && !compile.timedOut) writeFileSync(join(options.outputDir, 'app-release.apk'), apk);
  return { code: 0, timedOut: false, log: 'compiled', ...compile };
};

let deps: BuildDeps;

const setup = async (run: Run) => {
  deps = {
    builds,
    run,
    image: 'sitetoapk-builder:test',
    timeoutMs: 1000,
    workRoot: mkdtempSync(join(tmpdir(), 'f04-work-')),
    artifactsDir: mkdtempSync(join(tmpdir(), 'f04-artifacts-')),
    signing: {
      keystorePath: tempFile('key.jks', 'keystore'),
      storePassword: 'STORE_SECRET',
      keyPassword: 'KEY_SECRET',
      keyAlias: 'test',
      signerSha256: SIGNER,
    },
  };
  return createBuild(builds, {
    _id: randomUUID(), config, iconPath: await iconFile(), plan: 'free', versionCode: 1, versionName: '1.0',
  });
};

const load = (id: string) => builds.findOne({ _id: id as never });
const attempt = (attemptsMade = 0) => ({ attemptsMade, attempts: 3 });

beforeEach(() => builds.deleteMany({}));
afterAll(() => mongo.close());

describe('AC9: a good build', () => {
  it('moves through every status and stores the APK', async () => {
    const id = await setup(fakeRun());
    await processBuild(deps, id, attempt());
    const build = await load(id);
    expect(build?.history).toEqual(['queued', 'building', 'signing', 'uploading', 'success']);
    expect(build?.sha256).toBe(createHash('sha256').update(apk).digest('hex'));
    expect(readFileSync(build?.apkPath)).toEqual(apk);
  });

  it('ignores a build that has already finished', async () => {
    const id = await setup(fakeRun());
    await processBuild(deps, id, attempt());
    await processBuild(deps, id, attempt());
    expect((await load(id))?.history.filter((status: string) => status === 'success')).toHaveLength(1);
  });

  it('passes secrets as files, not arguments', async () => {
    let seen: string[] = [];
    let store = '';
    const run: Run = async (options) => {
      if (!options.entrypoint) {
        seen = options.args;
        store = readFileSync(join(options.secretsDir, 'store.pass'), 'utf8');
      }
      return fakeRun()(options);
    };
    const id = await setup(run);
    await processBuild(deps, id, attempt());
    expect(seen.join(' ')).not.toContain('SECRET');
    expect(seen).toContain('-PkeystorePassFile=/secrets/store.pass');
    expect(seen).toContain('-PgeneratedDir=/generated');
    expect(store).toBe('STORE_SECRET');
  });
});

describe('AC10: a failed check', () => {
  it('fails the build and stores nothing', async () => {
    const id = await setup(fakeRun({}, facts('com.wrong.app')));
    await expect(processBuild(deps, id, attempt())).rejects.toThrow(UnrecoverableError);
    const build = await load(id);
    expect(build?.status).toBe('failed');
    expect(build?.error).toContain('package');
    expect(readdirSync(deps.artifactsDir)).toEqual([]);
  });
});

describe('AC11: retries', () => {
  it('does not retry a compile error', async () => {
    const id = await setup(fakeRun({ code: 1, log: 'e: compile error' }));
    await expect(processBuild(deps, id, attempt())).rejects.toThrow(UnrecoverableError);
    const build = await load(id);
    expect(build?.status).toBe('failed');
    expect(build?.log).toContain('compile error');
  });

  it('does not retry bad input', async () => {
    const id = await setup(fakeRun());
    await builds.updateOne({ _id: id as never }, { $set: { iconPath: '/nonexistent.png' } });
    await expect(processBuild(deps, id, attempt())).rejects.toThrow(UnrecoverableError);
    expect((await load(id))?.status).toBe('failed');
  });

  it('retries when Docker itself fails', async () => {
    const id = await setup(fakeRun({ code: 125 }));
    await expect(processBuild(deps, id, attempt())).rejects.not.toThrow(UnrecoverableError);
    expect((await load(id))?.status).toBe('queued');
  });

  it('fails on the last attempt', async () => {
    const id = await setup(fakeRun({ code: 125 }));
    await expect(processBuild(deps, id, attempt(2))).rejects.toThrow();
    expect((await load(id))?.status).toBe('failed');
  });
});

describe('AC13: timeout', () => {
  it('fails with a timeout reason and no retry', async () => {
    const id = await setup(fakeRun({ code: 137, timedOut: true }));
    await expect(processBuild(deps, id, attempt())).rejects.toThrow(UnrecoverableError);
    expect((await load(id))?.error).toContain('timed out');
  });
});

describe('AC15: cleanup', () => {
  it.each([
    ['pass', fakeRun()],
    ['compile failure', fakeRun({ code: 1 })],
    ['timeout', fakeRun({ code: 137, timedOut: true })],
    ['Docker failure', fakeRun({ code: 125 })],
  ])('leaves nothing after a %s', async (_, run) => {
    const id = await setup(run);
    await processBuild(deps, id, attempt()).catch(() => undefined);
    expect(existsSync(join(deps.workRoot, id))).toBe(false);
  });
});
