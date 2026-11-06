import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStatus } from '@sitetoapk/shared/builds';
import { restore, takeDown } from '../src/abuse/takedown';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness();
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());

const operator = { reason: 'Phishing a bank login', operator: 'ops@example.com' };

/** A verified owner with one successful build that has a live install link, and one queued build. */
const builtApp = async () => {
  const address = `u${Math.random().toString(36).slice(2)}@example.com`;
  const owner = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  const draft = { startUrl: 'https://example.com/', appName: 'Example', packageName: `com.x${Math.random().toString(36).slice(2, 8)}.app`, ui: { statusBarColor: '#0F172A' } };
  const { id: appId } = await (await owner.post('/apps', draft)).json();
  await owner.upload(`/apps/${appId}/icon`, icon);

  const start = () => owner.post(`/apps/${appId}/builds`, { idempotencyKey: crypto.randomUUID() });
  const { id: built } = await (await start()).json();
  await h.icons.put(`free/${built}.apk`, Buffer.from('apk-bytes'));
  await setStatus(h.builds, built, 'success', { artifactKey: `free/${built}.apk`, artifactBytes: 9, sha256: 'x', expiresAt: new Date(Date.now() + 60_000) });
  const { url } = await (await owner.post(`/builds/${built}/install-link`)).json();
  const { id: queued } = await (await start()).json();
  return { owner, appId: appId as string, built: built as string, queued: queued as string, token: url.split('/').pop() as string, draft, start };
};

describe('F10 AC9: takedown', () => {
  it('stops every link, deletes the APK, refuses builds and edits, and tells the owner why', async () => {
    const { owner, appId, built, queued, token, draft, start } = await builtApp();
    expect((await owner.get(`/builds/${built}/download`)).status).toBe(302);

    const { deleted } = await takeDown({ db: h.db, storage: h.icons }, new ObjectId(appId), operator);
    expect(deleted).toEqual([`free/${built}.apk`]);

    expect((await owner.get(`/builds/${built}/download`)).status).toBe(410);
    expect((await h.client().get(`/builds/install/${token}`)).status).toBe(410);
    expect((await h.client().get(`/builds/install/${token}/download`)).status).toBe(410);
    expect(await h.icons.get(`free/${built}.apk`)).toBeNull();
    expect((await h.builds.findOne({ _id: queued as never }))?.status).toBe('canceled');

    const blocked = await start();
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ reason: 'taken_down' });
    expect((await owner.put(`/apps/${appId}`, { ...draft, appName: 'Renamed' })).status).toBe(403);
    expect((await owner.upload(`/apps/${appId}/icon`, icon)).status).toBe(403);

    const view = await (await owner.get(`/apps/${appId}`)).json();
    expect(view.takenDown.reason).toBe('Phishing a bank login');
    expect((await (await owner.get(`/builds/${built}`)).json()).removed).toBe(true);
  });
});

describe('F10 AC10: records and restore', () => {
  it('records both actions, allows builds again, and keeps deleted APKs deleted', async () => {
    const { owner, appId, built, start } = await builtApp();
    const id = new ObjectId(appId);
    await takeDown({ db: h.db, storage: h.icons }, id, operator);
    await restore({ db: h.db }, id, { reason: 'Owner proved the site is theirs', operator: 'ops@example.com' });

    const records = await h.db.collection('takedowns').find({ appId: id }).sort({ at: 1 }).toArray();
    expect(records.map((record) => [record.action, record.operator, record.reason])).toEqual([
      ['takedown', 'ops@example.com', 'Phishing a bank login'],
      ['restore', 'ops@example.com', 'Owner proved the site is theirs'],
    ]);
    expect(records[0]!.deleted).toEqual([`free/${built}.apk`]);
    expect(records[0]!.at).toBeInstanceOf(Date);

    expect((await start()).status).toBe(201);
    expect((await owner.get(`/builds/${built}/download`)).status).toBe(410);
    expect((await (await owner.get(`/apps/${appId}`)).json()).takenDown).toBeUndefined();
  });

  it('refuses to restore an app that isn’t down', async () => {
    const { appId } = await builtApp();
    await expect(restore({ db: h.db }, new ObjectId(appId), operator)).rejects.toThrow('not taken down');
  });
});
