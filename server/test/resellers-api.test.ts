import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness();
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());
const why = { reason: 'testing the api' };
const tag = () => Math.random().toString(36).slice(2, 8);

/** A verified reseller user on a plan with or without the API. */
const setup = async (api = true, builds = 5) => {
  const admin = await adminIn(h);
  const address = `u${tag()}@example.com`;
  const user = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `P ${tag()}`, priceMinor: 1, buildsPerMonth: builds, api, builtWithLine: true, ...why })).json();
  const { id } = await (await admin.user.post('/admin/api/resellers', { userEmail: address, slug: `s-${tag()}`, brandName: 'Agency', planId, ...why })).json();
  return { admin, user, resellerId: id as string };
};
const makeKey = async (user: Awaited<ReturnType<typeof signedIn>>, name = 'ci') => {
  const res = await user.post('/resellers/me/keys', { name });
  return { res, body: await res.json() };
};
const api = (key: string, path: string, init: RequestInit = {}) =>
  fetch(`${h.url}/api/v1${path}`, { ...init, headers: { authorization: `Bearer ${key}`, ...(init.body ? { 'content-type': init.body instanceof Uint8Array ? 'image/png' : 'application/json' } : {}) } });
const post = (key: string, path: string, body: unknown) => api(key, path, { method: 'POST', body: JSON.stringify(body) });

describe('AC5: keys and the key API', () => {
  it('shows the key once, stores only a hash, and lists a prefix', async () => {
    const { user } = await setup();
    const { res, body } = await makeKey(user);
    expect(res.status).toBe(201);
    expect(body.key).toMatch(/^rk_[A-Za-z0-9_-]{43}$/);
    const stored = await h.admin.resellers.keys.findOne({ _id: new ObjectId(body.id) });
    expect(JSON.stringify(stored)).not.toContain(body.key);
    const list = await (await user.get('/resellers/me/keys')).json();
    expect(list.keys[0]).toMatchObject({ id: body.id, name: 'ci', prefix: body.prefix, revoked: false });
    expect(JSON.stringify(list)).not.toContain(body.key);
  });

  it('creates an app, uploads its icon, builds, and reads the status with the key alone', async () => {
    const { user } = await setup();
    const { body } = await makeKey(user);
    const created = await post(body.key, '/apps', { startUrl: 'https://example.com/', appName: 'Client App', packageName: `com.app${tag()}.app`, ui: { statusBarColor: '#0F172A' } });
    expect(created.status).toBe(201);
    const { id: appId } = await created.json();
    expect((await api(body.key, `/apps/${appId}/icon`, { method: 'POST', body: new Uint8Array(icon) })).status).toBeLessThan(300);
    const started = await post(body.key, `/apps/${appId}/builds`, { idempotencyKey: randomUUID() });
    expect(started.status).toBe(201);
    const build = await started.json();
    const status = await api(body.key, `/builds/${build.id}`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ id: build.id, appId, status: 'queued' });
  });

  it('refuses a missing, wrong or revoked key', async () => {
    const { user } = await setup();
    const { body } = await makeKey(user);
    expect((await fetch(`${h.url}/api/v1/apps`)).status).toBe(401);
    expect((await api(`rk_${'x'.repeat(43)}`, '/apps')).status).toBe(401);
    expect((await api(body.key, '/apps')).status).toBe(200);
    expect((await user.post(`/resellers/me/keys/${body.id}/revoke`)).status).toBe(204);
    expect((await api(body.key, '/apps')).status).toBe(401);
  });

  it('is closed to a plan without the API', async () => {
    const { user } = await setup(false);
    const { res, body } = await makeKey(user);
    expect(res.status).toBe(403);
    expect(body.reason).toBe('api_not_in_plan');
  });

  it('only exposes the routes it names', async () => {
    const { user } = await setup();
    const { body } = await makeKey(user);
    expect((await api(body.key, '/apps/prefill', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })).status).toBe(404);
    const created = await (await post(body.key, '/apps', { startUrl: 'https://example.com/', appName: 'X', packageName: `com.app${tag()}.app` })).json();
    expect((await api(body.key, `/apps/${created.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await post(body.key, `/apps/${created.id}/push`, { title: 'a', body: 'b' })).status).toBe(404);
  });

  it('rate limits per key', async () => {
    const { user } = await setup();
    const { body } = await makeKey(user);
    const codes: number[] = [];
    for (let i = 0; i < 62; i++) codes.push((await api(body.key, '/apps')).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes.slice(60)).toEqual([429, 429]);
  });

  it('counts API builds against the quota', async () => {
    const { user } = await setup(true, 1);
    const { body } = await makeKey(user);
    const make = async () => (await (await post(body.key, '/apps', { startUrl: 'https://example.com/', appName: 'Q', packageName: `com.app${tag()}.app`, ui: { statusBarColor: '#0F172A' } })).json()).id as string;
    const [a, b] = [await make(), await make()];
    for (const id of [a, b]) await api(body.key, `/apps/${id}/icon`, { method: 'POST', body: new Uint8Array(icon) });
    expect((await post(body.key, `/apps/${a}/builds`, { idempotencyKey: randomUUID() })).status).toBe(201);
    expect((await post(body.key, `/apps/${b}/builds`, { idempotencyKey: randomUUID() })).status).toBe(429);
  });
});

describe('AC8: reseller isolation and suspension', () => {
  it('never shows or builds another reseller\'s app', async () => {
    const a = await setup();
    const b = await setup();
    const ka = (await makeKey(a.user)).body.key as string;
    const kb = (await makeKey(b.user)).body.key as string;
    const app = await (await post(ka, '/apps', { startUrl: 'https://example.com/', appName: 'Mine', packageName: `com.app${tag()}.app` })).json();
    expect((await api(kb, `/apps/${app.id}`)).status).toBe(404);
    expect((await post(kb, `/apps/${app.id}/builds`, { idempotencyKey: randomUUID() })).status).toBe(404);
    expect((await api(kb, '/apps').then((r) => r.json())).length).toBe(0);
  });

  it('stops a suspended reseller\'s key, and the admin can revoke a key', async () => {
    const { admin, user, resellerId } = await setup();
    const k1 = (await makeKey(user, 'one')).body;
    const k2 = (await makeKey(user, 'two')).body;
    expect((await admin.user.post(`/admin/api/resellers/${resellerId}/keys/${k1.id}/revoke`, why)).status).toBe(204);
    expect((await api(k1.key, '/apps')).status).toBe(401);
    await admin.user.post(`/admin/api/resellers/${resellerId}/suspend`, why);
    expect((await api(k2.key, '/apps')).status).toBe(403);
    expect((await h.admin.audit.find({ action: 'reseller.key.revoke' }).toArray()).length).toBeGreaterThan(0);
  });
});
