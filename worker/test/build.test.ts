import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { processBuild, type BuildDeps, type Run } from '../src/build';
import { createBuild, logChannel, logLinesKey, type BuildEvent } from '../src/builds';
import { createLogSink, redactor } from '../src/logs';
import { config, iconFile, tempFile } from './helpers';
import type { Storage } from '../src/storage';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const builds = mongo.db('sitetoapk_test').collection('builds_unit');
const buildLogs = mongo.db('sitetoapk_test').collection('buildLogs_unit');
const redis = new Redis('redis://127.0.0.1:6379');
const SIGNER = 'c5'.repeat(32);
const apk = Buffer.alloc(200 * 1024, 7);

const facts = (packageName = config.packageName) =>
  `package: name='${packageName}' versionCode='1' versionName='1.0'\nSigner #1 certificate SHA-256 digest: ${SIGNER}`;

// Stands in for Docker: compile writes an APK, and verify prints facts.
const fakeRun = (compile: Partial<Awaited<ReturnType<Run>>> = {}, verifyFacts = facts()): Run => async (options) => {
  if (options.entrypoint) return { code: 0, timedOut: false, log: verifyFacts };
  if ((compile.code ?? 0) === 0 && !compile.timedOut) writeFileSync(join(options.outputDir, 'app-release.apk'), apk);
  const result = { code: 0, timedOut: false, log: 'compiled', ...compile };
  result.log.split('\n').forEach((line) => options.onLine?.(line));
  return result;
};

let deps: BuildDeps;
let uploads: { key: string; body: Buffer }[] = [];
// Objects the fake storage can hand back, such as a build's icon copy.
const objects = new Map<string, Buffer>();

const fakeStorage = (fail = false): Storage => ({
  put: async (key, path) => {
    if (fail) throw new Error('storage down');
    const body = readFileSync(path);
    uploads.push({ key, body });
    return body.length;
  },
  download: async (key, path) => {
    const body = objects.get(key);
    if (!body) throw new Error(`no object ${key}`);
    writeFileSync(path, body);
  },
  signedLink: async () => '',
  remove: async () => undefined,
  applyLifecycle: async () => undefined,
  readLifecycle: async () => [],
});

const setup = async (run: Run, storage = fakeStorage()) => {
  uploads = [];
  deps = {
    builds,
    run,
    image: 'sitetoapk-builder:test',
    timeoutMs: 1000,
    workRoot: mkdtempSync(join(tmpdir(), 'f04-work-')),
    storage,
    logs: createLogSink(redis, buildLogs),
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
afterAll(async () => {
  redis.disconnect();
  await mongo.close();
});

describe('AC9: a good build', () => {
  it('moves through every status and stores the APK', async () => {
    const id = await setup(fakeRun());
    await processBuild(deps, id, attempt());
    const build = await load(id);
    expect(build?.history).toEqual(['queued', 'building', 'signing', 'uploading', 'success']);
    expect(build?.sha256).toBe(createHash('sha256').update(apk).digest('hex'));
    expect(build?.artifactKey).toBe(`free/${id}.apk`);
    expect(build?.artifactBytes).toBe(apk.length);
    expect(build?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(uploads).toEqual([{ key: `free/${id}.apk`, body: apk }]);
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
    expect(uploads).toEqual([]);
  });
});

describe('AC11: retries', () => {
  it('does not retry a compile error', async () => {
    const id = await setup(fakeRun({ code: 1, log: 'e: compile error' }));
    await expect(processBuild(deps, id, attempt())).rejects.toThrow(UnrecoverableError);
    const build = await load(id);
    expect(build?.status).toBe('failed');
    expect(build?.log).toBeUndefined();
    expect((await buildLogs.findOne({ _id: id as never }))?.lines).toEqual([{ n: 1, text: 'e: compile error' }]);
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

describe('AC4, AC5: failed upload', () => {
  it('retries, and never shows success', async () => {
    const id = await setup(fakeRun(), fakeStorage(true));
    await expect(processBuild(deps, id, attempt())).rejects.toThrow('storage down');
    const build = await load(id);
    expect(build?.status).toBe('queued');
    expect(build?.history).not.toContain('success');
    expect(existsSync(join(deps.workRoot, id))).toBe(false);
  });

  it('fails for good on the last attempt, leaving no APK', async () => {
    const id = await setup(fakeRun(), fakeStorage(true));
    await expect(processBuild(deps, id, attempt(2))).rejects.toThrow();
    expect((await load(id))?.status).toBe('failed');
    expect(existsSync(join(deps.workRoot, id))).toBe(false);
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

describe('F09 AC5: a website build', () => {
  const apps = mongo.db('sitetoapk_test').collection('apps_unit');

  const websiteBuild = async (run: Run) => {
    await setup(run);
    deps.apps = apps;
    const appId = new ObjectId();
    await apps.insertOne({ _id: appId, draft: { appName: 'Later name' } });
    const id = randomUUID();
    objects.set(`builds/${id}/icon.png`, readFileSync(await iconFile()));
    await createBuild(builds, {
      _id: id, config, iconKey: `builds/${id}/icon.png`, plan: 'free', versionCode: 1, versionName: '1.0', appId, ownerId: new ObjectId(),
    });
    return { id, appId };
  };

  it('builds from the icon copy and the config taken at the start, then locks the package name', async () => {
    let generated = '';
    const run: Run = async (options) => {
      if (!options.entrypoint) generated = readFileSync(join(options.generatedDir, 'assets', 'app_config.json'), 'utf8');
      return fakeRun()(options);
    };
    const { id, appId } = await websiteBuild(run);
    expect((await load(id))?.activeAppId).toEqual(appId);

    await processBuild(deps, id, attempt());
    expect(JSON.parse(generated).appName).toBe(config.appName);
    expect((await load(id))?.status).toBe('success');
    expect((await load(id))?.activeAppId).toBeUndefined();
    const locked = (await apps.findOne({ _id: appId }))?.lockedAt;
    expect(locked).toBeInstanceOf(Date);

    // A later success keeps the first lock time.
    const second = randomUUID();
    objects.set(`builds/${second}/icon.png`, readFileSync(await iconFile()));
    await createBuild(builds, { _id: second, config, iconKey: `builds/${second}/icon.png`, plan: 'free', versionCode: 1, versionName: '1.0', appId });
    await processBuild(deps, second, attempt());
    expect((await apps.findOne({ _id: appId }))?.lockedAt).toEqual(locked);
  });
});

describe('F10 AC9: takedown during a build', () => {
  it('fails the build before upload, so no APK is published', async () => {
    const apps = mongo.db('sitetoapk_test').collection('apps_unit');
    const id = await setup(fakeRun());
    deps.apps = apps;
    const appId = new ObjectId();
    await apps.insertOne({ _id: appId, takenDown: { reason: 'Phishing', at: new Date(), by: 'ops' } });
    await builds.updateOne({ _id: id as never }, { $set: { appId } });
    await expect(processBuild(deps, id, attempt())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await load(id)).toMatchObject({ status: 'failed', failureKind: 'input', error: 'App taken down' });
    expect(uploads).toEqual([]);
  });
});

describe('F09 AC8: failure kinds', () => {
  it.each([
    ['timeout', fakeRun({ timedOut: true, code: null })],
    ['compile', fakeRun({ code: 1 })],
    ['check', fakeRun({}, facts('com.wrong.app'))],
  ])('records a %s failure, counted toward the limit, and frees the app', async (kind, run) => {
    const id = await setup(run);
    await builds.updateOne({ _id: id as never }, { $set: { activeAppId: new ObjectId() } });
    await expect(processBuild(deps, id, attempt())).rejects.toBeInstanceOf(UnrecoverableError);
    const build = await load(id);
    expect(build).toMatchObject({ status: 'failed', failureKind: kind });
    expect(build?.countsTowardLimit).toBeUndefined();
    expect(build?.activeAppId).toBeUndefined();
  });

  it('records bad input', async () => {
    const id = await setup(fakeRun());
    await builds.updateOne({ _id: id as never }, { $unset: { iconPath: '' } });
    await expect(processBuild(deps, id, attempt())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await load(id)).toMatchObject({ status: 'failed', failureKind: 'input' });
  });

  it('records our own failure only after the last attempt, outside the limit', async () => {
    const id = await setup(fakeRun(), fakeStorage(true));
    await expect(processBuild(deps, id, attempt(0))).rejects.toThrow('storage down');
    expect((await load(id))?.status).toBe('queued');
    await expect(processBuild(deps, id, attempt(2))).rejects.toThrow('storage down');
    expect(await load(id)).toMatchObject({ status: 'failed', failureKind: 'infra', countsTowardLimit: false });
  });
});

describe('F09 AC6: live lines', () => {
  it('publishes each line in order with its number, then the statuses, and keeps the log at the end', async () => {
    const run = fakeRun({ log: 'Task :app:preBuild\nTask :app:compileReleaseKotlin\nBUILD SUCCESSFUL' });
    const id = await setup(run);
    const listener = new Redis('redis://127.0.0.1:6379');
    const events: BuildEvent[] = [];
    listener.on('message', (_channel, message) => events.push(JSON.parse(message)));
    await listener.subscribe(logChannel(id));

    await processBuild(deps, id, attempt());
    await new Promise((resolve) => setTimeout(resolve, 100));
    listener.disconnect();

    const lines = events.filter((event) => event.type === 'line');
    expect(lines.map((event) => [event.n, event.text])).toEqual([
      [1, 'Task :app:preBuild'],
      [2, 'Task :app:compileReleaseKotlin'],
      [3, 'BUILD SUCCESSFUL'],
    ]);
    expect(events.filter((event) => event.type === 'status').map((event) => event.status)).toEqual(['building', 'signing', 'uploading', 'success']);
    expect(await redis.llen(logLinesKey(id))).toBe(3);
    expect((await buildLogs.findOne({ _id: id as never }))?.lines).toHaveLength(3);
  });
});

describe('F09 AC7: secrets stay out of logs', () => {
  it('hides the build’s secrets, host paths, environment secrets and credential assignments', async () => {
    process.env.R2_SECRET_ACCESS_KEY = 'r2-secret-value-123';
    const id = await setup(fakeRun());
    const { keystorePath, storePassword, keyPassword } = deps.signing;
    const hostile = [
      `signing with ${storePassword} and ${keyPassword}`,
      `keystore at ${keystorePath}`,
      `work folder ${deps.workRoot}/${id}/generated`,
      'upload with r2-secret-value-123',
      'storePassword=whatever123 token: abc.def',
      'reading /Users/someone/.sitetoapk/test.jks',
    ].join('\n');
    deps.run = fakeRun({ log: hostile });

    await processBuild(deps, id, attempt());
    const stored = JSON.stringify((await buildLogs.findOne({ _id: id as never }))?.lines);
    for (const secret of [storePassword, keyPassword, keystorePath, deps.workRoot, 'r2-secret-value-123', 'whatever123', 'abc.def', '/Users/someone']) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).toContain('[hidden]');
    delete process.env.R2_SECRET_ACCESS_KEY;
  });

  it('leaves ordinary Gradle output alone', () => {
    const redact = redactor(['STORE_SECRET']);
    expect(redact('> Task :app:assembleRelease UP-TO-DATE')).toBe('> Task :app:assembleRelease UP-TO-DATE');
    expect(redact('Reading /generated/app_config.json')).toBe('Reading /generated/app_config.json');
  });
});
