import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStatus } from '@sitetoapk/shared/builds';
import { renewQuota } from '../src/resellers/quota';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness();
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());
const why = { reason: 'testing quota' };
const tag = () => Math.random().toString(36).slice(2, 8);

/** A verified reseller user on a fresh plan with `builds` a month, plus a ready app. */
const setup = async (builds: number) => {
  const admin = await adminIn(h);
  const address = `u${tag()}@example.com`;
  const user = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `P ${tag()}`, priceMinor: 1, buildsPerMonth: builds, api: false, builtWithLine: true, ...why })).json();
  const { id: resellerId } = await (await admin.user.post('/admin/api/resellers', { userEmail: address, slug: `s-${tag()}`, brandName: 'Agency', planId, ...why })).json();
  return { admin, user, resellerId: new ObjectId(resellerId), planId, address };
};
const readyApp = async (user: User) => {
  const { id } = await (await user.post('/apps', { startUrl: 'https://example.com/', appName: 'Example', packageName: `com.app${tag()}.app`, ui: { statusBarColor: '#0F172A' } })).json();
  await user.upload(`/apps/${id}/icon`, icon);
  return id as string;
};
const start = async (user: User, appId: string) => {
  const response = await user.post(`/apps/${appId}/builds`, { idempotencyKey: randomUUID() });
  return { status: response.status, body: await response.json() };
};
const used = async (id: ObjectId) => (await h.admin.resellers.resellers.findOne({ _id: id }))!.quota.used;

describe('AC3: quota', () => {
  it('refuses build N+1 and starts again after a paid renewal', async () => {
    const { user, resellerId } = await setup(2);
    const appId = await readyApp(user);
    for (let i = 0; i < 2; i++) {
      const built = await start(user, appId);
      expect(built.status).toBe(201);
      await setStatus(h.builds, built.body.id, 'success');
    }
    expect(await start(user, appId)).toMatchObject({ status: 429, body: { reason: 'quota_exhausted' } });
    expect(await used(resellerId)).toBe(2);
    expect(await renewQuota(h.admin.resellers, resellerId)).toBe(true);
    expect(await used(resellerId)).toBe(0);
    expect((await start(user, appId)).status).toBe(201);
  });

  it('lets two builds started together take only what is left', async () => {
    const { user, resellerId } = await setup(1);
    const [a, b] = [await readyApp(user), await readyApp(user)];
    const results = await Promise.all([start(user, a), start(user, b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(await used(resellerId)).toBe(1);
  });

  it('gives the build back when the start is refused (app already building)', async () => {
    const { user, resellerId } = await setup(5);
    const appId = await readyApp(user);
    expect((await start(user, appId)).status).toBe(201);
    expect((await start(user, appId)).status).toBe(409);
    expect(await used(resellerId)).toBe(1);
  });

  it('adds admin bonus quota on top of the plan and marks the build with its reseller', async () => {
    const { admin, user, resellerId } = await setup(0);
    const appId = await readyApp(user);
    expect((await start(user, appId)).status).toBe(429);
    await admin.user.post(`/admin/api/resellers/${resellerId}`, { addQuota: 1, ...why });
    const built = await start(user, appId);
    expect(built.status).toBe(201);
    expect((await h.builds.findOne({ _id: built.body.id }))!.resellerId).toEqual(resellerId);
  });

  it('does not touch ordinary users', async () => {
    const address = `u${tag()}@example.com`;
    const user = await signedIn(h, address);
    await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
    expect((await start(user, await readyApp(user))).status).toBe(201);
  });
});

describe('AC7 and AC8: lapsed and suspended', () => {
  it('refuses new builds on a lapsed plan but old builds stay readable', async () => {
    const { user, resellerId } = await setup(5);
    const appId = await readyApp(user);
    const first = await start(user, appId);
    await setStatus(h.builds, first.body.id, 'success');
    await h.admin.resellers.resellers.updateOne({ _id: resellerId }, { $set: { lapsedAt: new Date() } });
    expect(await start(user, appId)).toMatchObject({ status: 402, body: { reason: 'plan_lapsed' } });
    expect((await user.get(`/builds/${first.body.id}`)).status).toBe(200);
  });

  it('stops a suspended reseller\'s builds', async () => {
    const { admin, user, resellerId } = await setup(5);
    const appId = await readyApp(user);
    await admin.user.post(`/admin/api/resellers/${resellerId}/suspend`, why);
    expect(await start(user, appId)).toMatchObject({ status: 403, body: { reason: 'reseller_suspended' } });
  });
});
