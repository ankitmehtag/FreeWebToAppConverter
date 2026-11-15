import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const slug = () => `shop-${Math.random().toString(36).slice(2, 8)}`;
const why = { reason: 'testing resellers' };
const audit = () => h.admin.audit.find({}).sort({ createdAt: -1 }).toArray();

const plansOf = async (admin: Awaited<ReturnType<typeof adminIn>>) => (await (await admin.user.get('/admin/api/plans')).json()).plans as { id: string; name: string; priceMinor: number; buildsPerMonth: number }[];
const makeReseller = async (admin: Awaited<ReturnType<typeof adminIn>>, planId: string, extra: object = {}) => {
  const owner = email();
  await signedIn(h, owner);
  const s = slug();
  const res = await admin.user.post('/admin/api/resellers', { userEmail: owner, slug: s, brandName: 'Pixel Agency', planId, accent: '#ff5500', ...why, ...extra });
  return { res, slug: s };
};

describe('AC1: plans, resellers and the branded page', () => {
  it('starts with three plans the admin can see', async () => {
    const admin = await adminIn(h);
    expect((await plansOf(admin)).map((p) => p.name).sort()).toEqual(['Agency', 'Growth', 'Starter']);
  });

  it('creates a reseller and serves its brand publicly', async () => {
    const admin = await adminIn(h);
    const [plan] = (await plansOf(admin)) as [Awaited<ReturnType<typeof plansOf>>[number]];
    const { res, slug: s } = await makeReseller(admin, plan.id);
    expect(res.status).toBe(201);
    const brand = await h.client().get(`/resellers/${s}/brand`);
    expect(brand.status).toBe(200);
    expect(await brand.json()).toMatchObject({ slug: s, brandName: 'Pixel Agency', accent: '#ff5500' });
    expect(JSON.stringify(await (await h.client().get(`/resellers/${s}/brand`)).json())).not.toMatch(/userId|terms|quota/);
  });

  it('refuses a taken slug, an unknown user and a bad accent', async () => {
    const admin = await adminIn(h);
    const [plan] = (await plansOf(admin)) as [Awaited<ReturnType<typeof plansOf>>[number]];
    const first = await makeReseller(admin, plan.id);
    const other = email();
    await signedIn(h, other);
    expect((await admin.user.post('/admin/api/resellers', { userEmail: other, slug: first.slug, brandName: 'Dup', planId: plan.id, ...why })).status).toBe(409);
    expect((await admin.user.post('/admin/api/resellers', { userEmail: 'nobody@example.com', slug: slug(), brandName: 'Ghost', planId: plan.id, ...why })).status).toBe(404);
    expect((await admin.user.post('/admin/api/resellers', { userEmail: other, slug: slug(), brandName: 'Bad', planId: plan.id, accent: 'red', ...why })).status).toBe(400);
  });

  it('hides a suspended reseller and shows it again on reactivate', async () => {
    const admin = await adminIn(h);
    const [plan] = (await plansOf(admin)) as [Awaited<ReturnType<typeof plansOf>>[number]];
    const { res, slug: s } = await makeReseller(admin, plan.id);
    const { id } = await res.json();
    expect((await admin.user.post(`/admin/api/resellers/${id}/suspend`, why)).status).toBe(204);
    expect((await h.client().get(`/resellers/${s}/brand`)).status).toBe(404);
    expect((await admin.user.post(`/admin/api/resellers/${id}/reactivate`, why)).status).toBe(204);
    expect((await h.client().get(`/resellers/${s}/brand`)).status).toBe(200);
  });

  it('is closed to anyone who is not the verified admin', async () => {
    const user = await signedIn(h, email());
    expect((await user.get('/admin/api/plans')).status).toBe(404);
    expect((await user.post('/admin/api/resellers', {})).status).toBe(404);
  });
});

describe('AC10: editing from the admin panel', () => {
  it('gives a new joiner the new price but leaves an existing reseller on the old one', async () => {
    const admin = await adminIn(h);
    const created = await admin.user.post('/admin/api/plans', { name: `Pro ${slug()}`, priceMinor: 100000, buildsPerMonth: 20, api: true, builtWithLine: true, ...why });
    expect(created.status).toBe(201);
    const { id: planId } = await created.json();
    const old = await makeReseller(admin, planId);
    expect((await admin.user.post(`/admin/api/plans/${planId}`, { priceMinor: 150000, buildsPerMonth: 40, ...why })).status).toBe(204);
    const fresh = await makeReseller(admin, planId);
    const terms = async (r: { res: Response }) => (await h.admin.resellers.resellers.findOne({ _id: new ObjectId((await r.res.json()).id) }))!.terms;
    expect(await terms(old)).toMatchObject({ priceMinor: 100000, buildsPerMonth: 20 });
    expect(await terms(fresh)).toMatchObject({ priceMinor: 150000, buildsPerMonth: 40 });
  });

  it('applies a quota change at once only when asked', async () => {
    const admin = await adminIn(h);
    const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `Q ${slug()}`, priceMinor: 1, buildsPerMonth: 5, api: false, builtWithLine: true, ...why })).json();
    const r = await makeReseller(admin, planId);
    const rid = new ObjectId((await r.res.json()).id);
    await admin.user.post(`/admin/api/plans/${planId}`, { buildsPerMonth: 9, ...why });
    expect((await h.admin.resellers.resellers.findOne({ _id: rid }))!.terms.buildsPerMonth).toBe(5);
    await admin.user.post(`/admin/api/plans/${planId}`, { buildsPerMonth: 12, applyQuotaNow: true, ...why });
    expect((await h.admin.resellers.resellers.findOne({ _id: rid }))!.terms.buildsPerMonth).toBe(12);
  });

  it('edits brand, callback URL and quota by hand, and audits every change', async () => {
    const admin = await adminIn(h);
    const [plan] = (await plansOf(admin)) as [Awaited<ReturnType<typeof plansOf>>[number]];
    const r = await makeReseller(admin, plan.id);
    const { id } = await r.res.json();
    const edit = await admin.user.post(`/admin/api/resellers/${id}`, { brandName: 'Renamed', accent: '#00aa00', callbackUrl: 'https://example.com/hook', addQuota: 5, ...why });
    expect(edit.status).toBe(204);
    expect(await h.client().get(`/resellers/${r.slug}/brand`).then((x) => x.json())).toMatchObject({ brandName: 'Renamed', accent: '#00aa00' });
    const doc = (await h.admin.resellers.resellers.findOne({ _id: new ObjectId(id) }))!;
    expect(doc).toMatchObject({ callbackUrl: 'https://example.com/hook', quota: { bonus: 5, used: 0 } });
    expect((await admin.user.post(`/admin/api/resellers/${id}`, { callbackUrl: 'http://example.com/hook', ...why })).status).toBe(400);
    expect((await admin.user.post(`/admin/api/resellers/${id}`, { brandName: 'No reason' })).status).toBe(400);
    const actions = (await audit()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['reseller.create', 'reseller.edit', 'plan.create', 'plan.edit']));
  });
});

describe('what the admin lists show', () => {
  it('lists resellers with owner, plan and quota, and never a secret or hash', async () => {
    const admin = await adminIn(h);
    const [plan] = (await plansOf(admin)) as [Awaited<ReturnType<typeof plansOf>>[number]];
    const { res, slug: s } = await makeReseller(admin, plan.id);
    const { id } = await res.json();
    await h.admin.resellers.resellers.updateOne({ _id: new ObjectId(id) }, { $set: { callbackSecret: 'whsec_topsecret', callbackUrl: 'https://example.com/hook' } });
    const body = await (await admin.user.get('/admin/api/resellers')).json();
    const row = body.resellers.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({ slug: s, brandName: 'Pixel Agency', planName: plan.name, userEmail: expect.stringContaining('@'), callbackUrl: 'https://example.com/hook', suspended: false, quota: { used: 0, bonus: 0 } });
    expect(JSON.stringify(body)).not.toMatch(/whsec_topsecret|callbackSecret|hash|"userId"/);
  });
});
