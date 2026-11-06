import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue } from 'bullmq';
import { MongoClient } from 'mongodb';
import { afterAll, describe, expect, it } from 'vitest';
import type { BuildDeps, Run } from '../src/build';
import { enqueueBuild } from '../src/builds';
import { startWorker } from '../src/queue';
import { config, iconFile, tempFile } from './helpers';

const connection = { host: '127.0.0.1', port: 6379 };
const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const builds = mongo.db('sitetoapk_test').collection('builds_queue');
afterAll(() => mongo.close());

describe('AC12: concurrency', () => {
  it('runs no more than the limit and finishes every job', async () => {
    await builds.deleteMany({});
    const name = `test-${randomUUID()}`;
    let running = 0;
    let peak = 0;
    const SIGNER = 'c5'.repeat(32);
    const run: Run = async (options) => {
      if (options.entrypoint) {
        return { code: 0, timedOut: false, log: `package: name='${config.packageName}' versionCode='1' versionName='1.0'\nSHA-256 digest: ${SIGNER}` };
      }
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(join(options.outputDir, 'app-release.apk'), Buffer.alloc(200 * 1024));
      running -= 1;
      return { code: 0, timedOut: false, log: '' };
    };
    const deps: BuildDeps = {
      builds, run, image: 'test', timeoutMs: 1000,
      workRoot: mkdtempSync(join(tmpdir(), 'f04-work-')),
      storage: { put: async () => 1, download: async () => undefined, signedLink: async () => '', remove: async () => undefined, applyLifecycle: async () => undefined, readLifecycle: async () => [] },
      signing: { keystorePath: tempFile('k.jks', 'k'), storePassword: 'a', keyPassword: 'b', keyAlias: 'test', signerSha256: SIGNER },
    };
    const queue = new Queue(name, { connection });
    const worker = startWorker(deps, { connection, concurrency: 2, queueName: name });
    const iconPath = await iconFile();
    const ids = await Promise.all(
      Array.from({ length: 6 }, () =>
        enqueueBuild(builds, queue, { _id: randomUUID(), config, iconPath, plan: 'free', versionCode: 1, versionName: '1.0' }),
      ),
    );

    await expect
      .poll(() => builds.countDocuments({ _id: { $in: ids as never[] }, status: 'success' }), { timeout: 30000 })
      .toBe(6);
    expect(peak).toBe(2);
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });
});
