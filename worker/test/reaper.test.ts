import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BUILD_LABEL, listBuildContainers, removeContainer } from '../src/container';
import { reap } from '../src/reaper';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const builds = mongo.db('sitetoapk_test').collection('builds_reaper');
const timeoutMs = 60000;
const ago = (ms: number) => new Date(Date.now() - ms);
const workRoot = mkdtempSync(join(tmpdir(), 'f04-reaper-'));

const orphan = async (id: string) => {
  spawn('docker', ['run', '--rm', '--name', `sitetoapk-build-${id}`, '--label', `${BUILD_LABEL}=${id}`, '--platform', 'linux/amd64', '--entrypoint', 'sleep', 'sitetoapk-builder:dev', '120'], { stdio: 'ignore' });
  await expect.poll(listBuildContainers, { timeout: 30000 }).toHaveLength(1);
};

beforeEach(() => builds.deleteMany({}));
afterAll(() => mongo.close());

describe('AC14: reaper', () => {
  it('fails a build stuck past the timeout', async () => {
    const id = randomUUID();
    await builds.insertOne({ _id: id as never, status: 'building', startedAt: ago(timeoutMs * 5), history: [] });
    await reap({ builds, timeoutMs, workRoot });
    const build = await builds.findOne({ _id: id as never });
    expect(build?.status).toBe('failed');
    expect(build?.error).toContain('stuck');
  });

  it('leaves a build still inside its time', async () => {
    const id = randomUUID();
    await builds.insertOne({ _id: id as never, status: 'building', startedAt: ago(1000), history: [] });
    await reap({ builds, timeoutMs, workRoot });
    expect((await builds.findOne({ _id: id as never }))?.status).toBe('building');
  });

  it('removes a container whose build is finished, and its files', async () => {
    const id = randomUUID();
    await builds.insertOne({ _id: id as never, status: 'failed', history: [] });
    mkdirSync(join(workRoot, id));
    await orphan(id);
    await reap({ builds, timeoutMs, workRoot });
    expect(await listBuildContainers()).toEqual([]);
    expect(existsSync(join(workRoot, id))).toBe(false);
  });

  it('keeps a container for a live build', async () => {
    const id = randomUUID();
    await builds.insertOne({ _id: id as never, status: 'building', startedAt: new Date(), history: [] });
    mkdirSync(join(workRoot, id));
    await orphan(id);
    await reap({ builds, timeoutMs, workRoot });
    expect(await listBuildContainers()).toHaveLength(1);
    expect(existsSync(join(workRoot, id))).toBe(true);
    await removeContainer(`sitetoapk-build-${id}`);
    execFileSync('rm', ['-rf', join(workRoot, id)]);
  });
});
