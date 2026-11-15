import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/auth/tokens';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const why = { reason: 'testing the brand' };
const tag = () => Math.random().toString(36).slice(2, 8);

const setup = async (builtWithLine = true) => {
  const admin = await adminIn(h);
  const address = `u${tag()}@example.com`;
  const user = await signedIn(h, address);
  const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `P ${tag()}`, priceMinor: 1, buildsPerMonth: 7, api: true, builtWithLine, ...why })).json();
  const slug = `s-${tag()}`;
  const { id } = await (await admin.user.post('/admin/api/resellers', { userEmail: address, slug, brandName: 'Pixel Agency', accent: '#ff5500', planId, ...why })).json();
  return { admin, user, slug, resellerId: new ObjectId(id as string), address };
};

describe('AC4: the reseller\'s brand and Premium apps', () => {
  it('makes a reseller\'s apps Premium, and lets them use ads', async () => {
    const { user } = await setup();
    const app = await (await user.post('/apps', { appName: 'Client One' })).json();
    expect((await h.apps.findOne({ _id: new ObjectId(app.id) }))!.plan).toBe('premium');
    const withAds = await user.post('/apps', { appName: 'Client Two', ads: { enabled: true } });
    expect(withAds.status).not.toBe(403);
  });

  it('leaves an ordinary user\'s app Free, and still refuses their ads', async () => {
    const user = await signedIn(h, `u${tag()}@example.com`);
    const app = await (await user.post('/apps', { appName: 'Mine' })).json();
    expect((await h.apps.findOne({ _id: new ObjectId(app.id) }))!.plan ?? 'free').toBe('free');
    expect((await user.post('/apps', { appName: 'Mine Two', ads: { enabled: true } })).status).toBe(403);
  });

  it('shows the dashboard its brand, plan and quota, and only to the reseller', async () => {
    const { user, admin, resellerId } = await setup();
    await admin.user.post(`/admin/api/resellers/${resellerId}`, { addQuota: 3, ...why });
    const me = await (await user.get('/resellers/me')).json();
    expect(me).toMatchObject({ brand: { brandName: 'Pixel Agency', accent: '#ff5500' }, quota: { limit: 10, used: 0, remaining: 10 }, apiEnabled: true, lapsed: false });
    expect(me.plan.name).toMatch(/^P /);
    expect((await (await signedIn(h, `u${tag()}@example.com`)).get('/resellers/me')).status).toBe(404);
  });

  it('puts the brand on the download page of a reseller\'s build, and not on others', async () => {
    const { resellerId } = await setup(false);
    const make = async (extra: object) => {
      const buildId = `b-${tag()}`;
      const token = randomBytes(32).toString('base64url');
      await h.builds.insertOne({ _id: buildId as never, status: 'success', artifactKey: 'k', artifactBytes: 5, expiresAt: new Date(Date.now() + 3600_000), config: { appName: 'Shop' }, versionName: '1.0', versionCode: 1, createdAt: new Date(), updatedAt: new Date(), ...extra } as never);
      await h.db.collection('installTokens').insertOne({ hash: sha256(token), buildId, expiresAt: new Date(Date.now() + 3600_000) });
      return (await (await h.client().get(`/builds/install/${token}`)).json()) as { brand?: Record<string, unknown> };
    };
    expect((await make({ resellerId })).brand).toEqual({ slug: expect.any(String), brandName: 'Pixel Agency', logoUrl: null, accent: '#ff5500', showBuiltWith: false });
    expect((await make({})).brand).toBeUndefined();
  });
});
