import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPlan } from '../src/apps/plan';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

const SHA256 = 'CC:DD';
const makeApp = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Shop' })).json();
  const stored = (await h.apps.findOne({ _id: new ObjectId(app.id) }))!;
  return { user, appId: new ObjectId(app.id), ownerId: stored.ownerId as ObjectId };
};
const seedBuild = async (appId: ObjectId, ownerId: ObjectId, fields: Record<string, unknown>) => {
  const id = randomUUID();
  await h.builds.insertOne({ _id: id as never, appId, ownerId, status: 'success', versionCode: 1, versionName: '1.0', createdAt: new Date(), updatedAt: new Date(), ...fields });
  return id;
};
const location = async (user: Awaited<ReturnType<typeof makeApp>>['user'], path: string) => {
  const response = await user.get(path, { redirect: 'manual' } as never);
  return { status: response.status, to: response.headers.get('location') ?? '' };
};

describe('AC8, AC15: a Premium build is shown with both files and is kept', () => {
  it('shows the bundle, the certificate and no expiry', async () => {
    const { user, appId, ownerId } = await makeApp();
    const id = await seedBuild(appId, ownerId, {
      plan: 'premium', artifactKey: `premium/x.apk`, artifactBytes: 100, sha256: 'a'.repeat(64), expiresAt: null,
      aabKey: `premium/x.aab`, aabBytes: 200, aabSha256: 'b'.repeat(64), signerSha1: 'AA:BB', signerSha256: SHA256,
    });
    const build = await (await user.get(`/builds/${id}`)).json();
    expect(build).toMatchObject({
      plan: 'premium', expired: false,
      aab: { bytes: 200, sha256: 'b'.repeat(64) },
      signer: { sha1: 'AA:BB', sha256: SHA256 },
    });
    expect(build.expiresAt ?? null).toBeNull();
  });

  it('downloads the APK and the AAB, with no expiry date', async () => {
    const { user, appId, ownerId } = await makeApp();
    const id = await seedBuild(appId, ownerId, { plan: 'premium', artifactKey: 'premium/x.apk', aabKey: 'premium/x.aab', expiresAt: null });
    const apk = await location(user, `/builds/${id}/download`);
    const aab = await location(user, `/builds/${id}/download?file=aab`);
    expect(apk.status).toBe(302);
    expect(apk.to).toContain('premium/x.apk');
    expect(aab.status).toBe(302);
    expect(aab.to).toContain('premium/x.aab');
  });

  it('still expires a Free build and has no bundle for it', async () => {
    const { user, appId, ownerId } = await makeApp();
    const id = await seedBuild(appId, ownerId, { plan: 'free', artifactKey: 'free/x.apk', expiresAt: new Date(Date.now() - 1000) });
    expect((await location(user, `/builds/${id}/download`)).status).toBe(410);
    expect((await user.get(`/builds/${id}/download?file=aab`)).status).toBe(404);
    expect((await (await user.get(`/builds/${id}`)).json()).expired).toBe(true);
  });
});

describe('AC16: the reinstall warning', () => {
  const warning = async (user: Awaited<ReturnType<typeof makeApp>>['user'], appId: ObjectId) =>
    (await (await user.get(`/apps/${appId}`)).json()).reinstallWarning;

  it('shows for a Premium app that has only Free builds', async () => {
    const { user, appId, ownerId } = await makeApp();
    await seedBuild(appId, ownerId, { plan: 'free', artifactKey: 'free/x.apk', expiresAt: new Date(Date.now() + 100000) });
    await h.apps.updateOne({ _id: appId }, { $set: { buildCount: 1 } });
    expect(await warning(user, appId)).toBe(false);
    await setPlan(h.apps, appId, 'premium');
    expect(await warning(user, appId)).toBe(true);
  });

  it('goes away once a Premium build exists, and never shows for a new app', async () => {
    const { user, appId, ownerId } = await makeApp();
    await setPlan(h.apps, appId, 'premium');
    expect(await warning(user, appId)).toBe(false);
    await h.apps.updateOne({ _id: appId }, { $set: { buildCount: 2 } });
    await seedBuild(appId, ownerId, { plan: 'free', artifactKey: 'free/x.apk', expiresAt: new Date() });
    await seedBuild(appId, ownerId, { plan: 'premium', artifactKey: 'premium/x.apk', expiresAt: null });
    expect(await warning(user, appId)).toBe(false);
  });
});
