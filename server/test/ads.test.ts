import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPlan } from '../src/apps/plan';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness();
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());

const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const ids = { appId: 'ca-app-pub-1234567890123456~1234567890', bannerUnitId: 'ca-app-pub-1234567890123456/1111111111' };
const base = () => ({ startUrl: 'https://example.com/', appName: 'Example', packageName: `com.app${Math.random().toString(36).slice(2, 8)}.app`, ui: { statusBarColor: '#0F172A' } });

const verifiedUser = async () => {
  const address = email();
  const user = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  return user;
};
const readyApp = async (user: User, premium: boolean) => {
  const { id } = await (await user.post('/apps', base())).json();
  await user.upload(`/apps/${id}/icon`, icon);
  if (premium) await setPlan(h.apps, new ObjectId(id), 'premium');
  return id as string;
};

describe('AC1: ads are Premium only, in the server', () => {
  it('refuses to create an app with ads on', async () => {
    const user = await verifiedUser();
    const res = await user.post('/apps', { ...base(), ads: { enabled: true, ...ids } });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('ads_premium');
  });

  it('refuses a Free app turning ads on, and keeps the draft as it was', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, false);
    const res = await user.put(`/apps/${id}`, { ...base(), ads: { enabled: true, ...ids } });
    expect(res.status).toBe(403);
    expect((await h.apps.findOne({ _id: new ObjectId(id) }))?.draft.ads).toBeUndefined();
  });

  it('lets a Free app save with ads off', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, false);
    expect((await user.put(`/apps/${id}`, { ...base(), ads: { enabled: false } })).status).toBe(200);
  });

  it('refuses a build when a Free app has ads in its draft, queuing nothing', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, false);
    // As if the app was Premium when ads were saved and was moved back to Free afterwards.
    await h.apps.updateOne({ _id: new ObjectId(id) }, { $set: { 'draft.ads': { enabled: true, ...ids } } });
    const jobs = h.jobs.length;
    const res = await user.post(`/apps/${id}/builds`, { idempotencyKey: randomUUID() });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('ads_premium');
    expect(h.jobs.length).toBe(jobs);
  });
});

describe('AC2, AC3: a Premium app keeps and builds with its ad settings', () => {
  it('saves valid settings and the draft keeps them', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, true);
    const ads = { enabled: true, ...ids, bannerPosition: 'top', interstitialGapSeconds: 120, childDirected: false };
    expect((await user.put(`/apps/${id}`, { ...base(), ads })).status).toBe(200);
    expect((await h.apps.findOne({ _id: new ObjectId(id) }))?.draft.ads).toMatchObject({ enabled: true, appId: ids.appId, bannerPosition: 'top' });
  });

  it('refuses malformed IDs, naming the field', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, true);
    const res = await user.put(`/apps/${id}`, { ...base(), ads: { enabled: true, ...ids, appId: 'ca-app-pub-1~2' } });
    expect(res.status).toBe(400);
  });

  it('an incomplete setup keeps the app not ready, so it cannot build', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, true);
    const res = await user.put(`/apps/${id}`, { ...base(), ads: { enabled: true, appId: ids.appId } });
    expect(res.status).toBe(200);
    expect((await res.json()).ready).toBe(false);
  });

  it('queues a build with the ad settings in its config', async () => {
    const user = await verifiedUser();
    const id = await readyApp(user, true);
    await user.put(`/apps/${id}`, { ...base(), ads: { enabled: true, ...ids } });
    const res = await user.post(`/apps/${id}/builds`, { idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
    const build = await h.builds.findOne({ appId: new ObjectId(id) });
    expect(build?.config.ads).toMatchObject({ appId: ids.appId, bannerUnitId: ids.bannerUnitId, bannerPosition: 'bottom', interstitialGapSeconds: 180, childDirected: false });
  });
});
