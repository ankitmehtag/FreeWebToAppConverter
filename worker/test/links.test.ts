import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDownloadLink, deleteArtifact } from '../src/links';
import { artifactKey, type Storage } from '../src/storage';
import { tempFile } from './helpers';
import { testStorage } from './storage-helpers';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const builds = mongo.db('sitetoapk_test').collection('builds_links');
const storage: Storage = await testStorage();
const deps = { builds, storage };
const future = () => new Date(Date.now() + 60000);

const stored = async (fields = {}) => {
  const id = randomUUID();
  const key = artifactKey('free', id);
  await storage.put(key, tempFile('a.apk', Buffer.alloc(1024, 3)));
  await builds.insertOne({ _id: id as never, status: 'success', artifactKey: key, expiresAt: future(), ...fields });
  return id;
};

beforeEach(() => builds.deleteMany({}));
afterAll(() => mongo.close());

describe('AC7: expiry', () => {
  it('a link stops working after its lifetime', async () => {
    const link = await createDownloadLink(deps, await stored(), 1);
    expect((await fetch(link)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(link)).status).toBe(403);
  });

  it('issues no link for an expired build', async () => {
    const id = await stored({ expiresAt: new Date(Date.now() - 1000) });
    await expect(createDownloadLink(deps, id)).rejects.toThrow('expired');
  });
});

describe('AC8: only finished builds', () => {
  it.each(['failed', 'queued', 'building'])('issues no link for a %s build', async (status) => {
    await expect(createDownloadLink(deps, await stored({ status }))).rejects.toThrow('not available');
  });

  it('issues no link for an unknown build', async () => {
    await expect(createDownloadLink(deps, randomUUID())).rejects.toThrow('not available');
  });
});

describe('AC11: delete', () => {
  it('breaks old links and blocks new ones', async () => {
    const id = await stored();
    const link = await createDownloadLink(deps, id);
    await deleteArtifact(deps, id);
    expect((await fetch(link)).status).toBe(404);
    await expect(createDownloadLink(deps, id)).rejects.toThrow('not available');
  });
});
