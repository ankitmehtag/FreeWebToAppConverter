import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeystoreOnce, scheduleErase } from '@sitetoapk/shared/keystore';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

const secrets = { alias: 'app-1a2b3c', storePassword: 'STORE-PASS-xyz', keyPassword: 'STORE-PASS-xyz', keystore: Buffer.from('PKCS12-BYTES') };
const prints = { sha1: 'AA:BB', sha256: 'CC:DD' };

/** A user, an app of theirs and a key for it. */
const withKey = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Shop' })).json();
  const ownerId = (await h.apps.findOne({ _id: new ObjectId(app.id) }))!.ownerId as ObjectId;
  await createKeystoreOnce(h.keystores, h.ring, new ObjectId(app.id), secrets, prints, ownerId);
  return { user, appId: String(app.id) };
};
const confirm = { confirm: true };

describe('the key status', () => {
  it('shows the owner the fingerprints and whether it was downloaded', async () => {
    const { user, appId } = await withKey();
    const body = await (await user.get(`/keystores/${appId}`)).json();
    expect(body).toMatchObject({ downloaded: false, sha1: 'AA:BB', sha256: 'CC:DD' });
    expect(JSON.stringify(body)).not.toContain('STORE-PASS');
  });

  it('answers 404 to another user and for an app with no key', async () => {
    const { appId } = await withKey();
    const stranger = await signedIn(h, email());
    expect((await stranger.get(`/keystores/${appId}`)).status).toBe(404);
    expect((await stranger.get(`/keystores/${new ObjectId()}`)).status).toBe(404);
    expect((await stranger.get('/keystores/not-an-id')).status).toBe(404);
  });
});

describe('AC11: the one-time download', () => {
  it('needs the confirmation box', async () => {
    const { user, appId } = await withKey();
    expect((await user.post(`/keystores/${appId}/download`, {})).status).toBe(400);
    expect((await user.post(`/keystores/${appId}/download`, { confirm: false })).status).toBe(400);
    expect((await user.get(`/keystores/${appId}`).then((r) => r.json())).downloaded).toBe(false);
  });

  it('gives the owner the key and its passwords once, never cached, and logs it', async () => {
    const { user, appId } = await withKey();
    const response = await user.post(`/keystores/${appId}/download`, confirm);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const zip = Buffer.from(await response.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.includes('keystore.p12')).toBe(true);
    expect(zip.includes('key-details.txt')).toBe(true);
    expect(zip.includes('PKCS12-BYTES')).toBe(true);
    expect(zip.includes('STORE-PASS-xyz')).toBe(true);
    expect(zip.includes('app-1a2b3c')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await (await user.get(`/keystores/${appId}`)).json()).downloaded).toBe(true);
    expect(await h.downloads.countDocuments({ appId: new ObjectId(appId) })).toBe(1);
    expect((await user.post(`/keystores/${appId}/download`, confirm)).status).toBe(409);
  });

  it('lets exactly one of two parallel downloads through', async () => {
    const { user, appId } = await withKey();
    const results = await Promise.all([1, 2, 3].map(() => user.post(`/keystores/${appId}/download`, confirm).then(async (r) => { await r.arrayBuffer(); return r.status; })));
    expect(results.filter((status) => status === 200)).toHaveLength(1);
  });

  it('is refused for another user, and nothing is marked downloaded', async () => {
    const { appId } = await withKey();
    const stranger = await signedIn(h, email());
    expect((await stranger.post(`/keystores/${appId}/download`, confirm)).status).toBe(404);
    expect((await h.keystores.findOne({ appId: new ObjectId(appId) }))!.downloadedAt).toBeNull();
  });

  it('still works during the 7 days before erasing, and shows the erase date', async () => {
    const { user, appId } = await withKey();
    await scheduleErase(h.keystores, { appId: new ObjectId(appId) });
    expect((await (await user.get(`/keystores/${appId}`)).json()).eraseOn).toBeTruthy();
    expect((await user.post(`/keystores/${appId}/download`, confirm)).status).toBe(200);
  });

  it('needs a signed-in user and a CSRF token', async () => {
    const { appId } = await withKey();
    expect((await h.client().post(`/keystores/${appId}/download`, confirm)).status).toBe(401);
    const { user, appId: own } = await withKey();
    expect((await user.post(`/keystores/${own}/download`, confirm, { csrf: null } as never)).status).toBe(403);
  });
});
