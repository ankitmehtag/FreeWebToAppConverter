import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkCode, codeNow, newSecret, seal, unseal } from '../src/admin/totp';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const why = { reason: 'testing the panel' };

const someApp = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Shop' })).json();
  return { user, appId: app.id as string, ownerId: (await h.apps.findOne({ _id: new ObjectId(app.id) }))!.ownerId as ObjectId };
};
const audit = () => h.admin.audit.find({}).sort({ createdAt: -1 }).toArray();

describe('TOTP', () => {
  it('accepts the current code once and refuses a wrong one', () => {
    const secret = newSecret();
    expect(checkCode(secret, codeNow(secret))).toEqual(expect.any(Number));
    expect(checkCode(secret, '000000') === null || codeNow(secret) === '000000').toBe(true);
    expect(checkCode(secret, 'abcdef')).toBeNull();
  });
  it('matches the RFC 6238 test vector', () => {
    // "12345678901234567890" in base32, at T=59 s the 6-digit code is 287082.
    expect(codeNow('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
  });
  it('seals a secret so it is not readable without the server key', () => {
    const sealed = seal('server-secret-aaaaaaaaaaaaaaaaaaaaaaaa', 'ABCDEFGH');
    expect(sealed).not.toContain('ABCDEFGH');
    expect(unseal('server-secret-aaaaaaaaaaaaaaaaaaaaaaaa', sealed)).toBe('ABCDEFGH');
    expect(() => unseal('another-secret-bbbbbbbbbbbbbbbbbbbbbbbb', sealed)).toThrow();
  });
});

describe('AC1: only the admin gets in', () => {
  it('answers 404 to a visitor with no session', async () => {
    expect((await h.client().get('/admin/api/overview')).status).toBe(404);
  });
  it('answers 404 to a signed-in user who is not the admin', async () => {
    const user = await signedIn(h, email());
    for (const path of ['/admin/api/overview', '/admin/api/users', '/admin/api/audit', '/admin/api/2fa']) expect((await user.get(path)).status).toBe(404);
    expect((await user.post('/admin/api/apps/' + '0'.repeat(24) + '/plan', { plan: 'premium', ...why })).status).toBe(404);
  });
  it('answers 404 to an admin address that was never verified', async () => {
    const other = await makeHarness();
    try {
      const user = await signedIn(other, 'admin@example.com');
      expect((await user.get('/admin/api/2fa')).status).toBe(404);
    } finally {
      await other.close();
    }
  });
  it('sets noindex headers', async () => {
    const { user } = await adminIn(h);
    const res = await user.get('/admin/api/overview');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });
});

describe('AC2: the second step', () => {
  it('refuses admin routes until a correct code is given', async () => {
    const { user, secret } = await adminIn(h, { twoFactor: false });
    const blocked = await user.get('/admin/api/overview');
    expect(blocked.status).toBe(401);
    expect((await blocked.json()).reason).toBe('two_factor');
    expect((await user.post('/admin/api/2fa/verify', { code: '123456' })).status).toBe(401);
    expect((await user.post('/admin/api/2fa/verify', { code: codeNow(secret) })).status).toBe(204);
    expect((await user.get('/admin/api/overview')).status).toBe(200);
  });
  it('refuses a code that was already used', async () => {
    const { user, secret } = await adminIn(h);
    const second = h.client();
    await second.post('/auth/login', { email: 'admin@example.com', password: 'correct-horse-battery' });
    expect((await second.post('/admin/api/2fa/verify', { code: codeNow(secret) })).status).toBe(401);
  });
  it('locks after five wrong codes', async () => {
    const { user } = await adminIn(h, { twoFactor: false });
    for (let i = 0; i < 5; i += 1) await user.post('/admin/api/2fa/verify', { code: '000001' });
    expect((await user.post('/admin/api/2fa/verify', { code: '000001' })).status).toBe(429);
  });
  it('needs the CSRF token on a write', async () => {
    const { user } = await adminIn(h);
    expect((await user.post('/admin/api/coupons', {}, { csrf: null })).status).toBe(403);
  });
});

describe('AC3-AC4, AC8: overview and lists', () => {
  it('counts what is in the database', async () => {
    const { user } = await adminIn(h);
    const before = await (await user.get('/admin/api/overview')).json();
    await someApp();
    await h.builds.insertOne({ _id: randomUUID() as never, status: 'queued', plan: 'free', createdAt: new Date(), updatedAt: new Date() } as never);
    const after = await (await user.get('/admin/api/overview')).json();
    expect(after.users.total).toBe(before.users.total + 1);
    expect(after.apps.total).toBe(before.apps.total + 1);
    expect(after.builds.queued).toBe(before.builds.queued + 1);
  });
  it('finds a user and lists their apps, builds and orders', async () => {
    const { user } = await adminIn(h);
    const { appId, ownerId } = await someApp();
    const owner = await h.users.findOne({ _id: ownerId });
    const found = await (await user.get(`/admin/api/users?q=${encodeURIComponent(String(owner!.email).slice(0, 8))}`)).json();
    expect(found.map((u: { email: string }) => u.email)).toContain(owner!.email);
    const detail = await (await user.get(`/admin/api/users/${ownerId}`)).json();
    expect(detail.apps.map((a: { id: string }) => a.id)).toContain(appId);
    expect(detail.apps[0].name).toBe('Shop');
  });
  it('shows a build with its log', async () => {
    const { user } = await adminIn(h);
    const id = randomUUID();
    await h.builds.insertOne({ _id: id as never, status: 'failed', plan: 'free', error: 'boom', createdAt: new Date(), updatedAt: new Date() } as never);
    await h.db.collection('buildLogs').insertOne({ _id: id as never, lines: [{ n: 1, text: 'hello' }] });
    const body = await (await user.get(`/admin/api/builds/${id}`)).json();
    expect(body).toMatchObject({ status: 'failed', error: 'boom', log: [{ n: 1, text: 'hello' }] });
  });
  it('never returns a secret', async () => {
    const { user } = await adminIn(h);
    await someApp();
    const bodies = await Promise.all(['/admin/api/overview', '/admin/api/users', '/admin/api/apps', '/admin/api/builds', '/admin/api/orders', '/admin/api/audit'].map(async (p) => JSON.stringify(await (await user.get(p)).json())));
    for (const body of bodies) expect(body).not.toMatch(/passwordHash|sealed|storePassword|keyPassword|keystore|secret|googleSub/i);
  });
});

describe('AC5: plan change', () => {
  it('sets the plan and writes one audit entry', async () => {
    const { user } = await adminIn(h);
    const { appId } = await someApp();
    const before = (await audit()).length;
    expect((await user.post(`/admin/api/apps/${appId}/plan`, { plan: 'premium', reason: 'gift' })).status).toBe(204);
    expect((await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan).toBe('premium');
    const entries = await audit();
    expect(entries.length).toBe(before + 1);
    expect(entries[0]).toMatchObject({ action: 'app.plan', actor: 'admin@example.com', reason: 'gift', target: { kind: 'app', id: appId }, detail: { to: 'premium' } });
  });
  it('requires a reason', async () => {
    const { user } = await adminIn(h);
    const { appId } = await someApp();
    expect((await user.post(`/admin/api/apps/${appId}/plan`, { plan: 'premium' })).status).toBe(400);
  });
});

describe('builds and users', () => {
  it('retries a failed build and queues it once', async () => {
    const { user } = await adminIn(h);
    const id = randomUUID();
    await h.builds.insertOne({ _id: id as never, status: 'failed', plan: 'free', error: 'x', failureKind: 'infra', createdAt: new Date(), updatedAt: new Date(), history: ['queued', 'failed'] } as never);
    const jobs = h.jobs.length;
    expect((await user.post(`/admin/api/builds/${id}/retry`, why)).status).toBe(204);
    expect(await h.builds.findOne({ _id: id as never })).toMatchObject({ status: 'queued', countsTowardLimit: false });
    expect(h.jobs.length).toBe(jobs + 1);
    expect((await user.post(`/admin/api/builds/${id}/retry`, why)).status).toBe(409);
  });
  it('cancels only a queued build', async () => {
    const { user } = await adminIn(h);
    const queued = randomUUID();
    const running = randomUUID();
    await h.builds.insertMany([{ _id: queued as never, status: 'queued', createdAt: new Date() }, { _id: running as never, status: 'building', createdAt: new Date() }] as never);
    expect((await user.post(`/admin/api/builds/${queued}/cancel`, why)).status).toBe(204);
    expect((await h.builds.findOne({ _id: queued as never }))?.status).toBe('canceled');
    expect((await user.post(`/admin/api/builds/${running}/cancel`, why)).status).toBe(409);
  });
  it('disables a user: sessions end and sign-in is refused', async () => {
    const { user } = await adminIn(h);
    const victim = await signedIn(h, email());
    const victimId = (await h.users.findOne({ email: (await (await victim.get('/auth/me')).json()).email }))!._id;
    expect((await user.post(`/admin/api/users/${victimId}/disable`, why)).status).toBe(204);
    expect((await victim.get('/auth/me')).status).toBe(401);
    const again = h.client();
    expect((await again.post('/auth/login', { email: (await h.users.findOne({ _id: victimId }))!.email, password: 'correct-horse-battery' })).status).toBe(401);
    expect((await user.post(`/admin/api/users/${victimId}/enable`, why)).status).toBe(204);
    expect((await again.post('/auth/login', { email: (await h.users.findOne({ _id: victimId }))!.email, password: 'correct-horse-battery' })).status).toBe(200);
  });
  it('will not disable the admin themself', async () => {
    const { user, id } = await adminIn(h);
    expect((await user.post(`/admin/api/users/${id}/disable`, why)).status).toBe(409);
  });
});

describe('AC6: refund', () => {
  const paid = async () => {
    const { user, appId, ownerId } = await someApp();
    const { id } = await (await user.post('/payments/checkout', { appId })).json();
    await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'paid', paidAt: new Date(), paymentId: `pay_${id}` } });
    await h.apps.updateOne({ _id: new ObjectId(appId) }, { $set: { plan: 'premium' } });
    return { orderId: id as string, appId, ownerId };
  };
  it('refunds once even if clicked twice, and returns the app to Free', async () => {
    const { user } = await adminIn(h);
    const { orderId, appId } = await paid();
    const results = await Promise.all([user.post(`/admin/api/orders/${orderId}/refund`, why), user.post(`/admin/api/orders/${orderId}/refund`, why)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(h.refunds.filter((r) => r.paymentId === `pay_${orderId}`)).toHaveLength(1);
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('refunded');
    expect((await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan).toBe('free');
    expect((await user.post(`/admin/api/orders/${orderId}/refund`, why)).status).toBe(409);
  });
});

describe('coupons', () => {
  it('creates a usable coupon and refuses a duplicate', async () => {
    const { user } = await adminIn(h);
    const code = `SAVE${Math.floor(Math.random() * 1e6)}`;
    expect((await user.post('/admin/api/coupons', { code, kind: 'percent', percent: 50, ...why })).status).toBe(201);
    expect(await h.db.collection('coupons').findOne({ code })).toMatchObject({ kind: 'percent', percent: 50, plan: 'premium', used: 0 });
    expect((await user.post('/admin/api/coupons', { code, kind: 'percent', percent: 50, ...why })).status).toBe(409);
    expect((await user.post('/admin/api/coupons', { code: 'BAD1', kind: 'percent', ...why })).status).toBe(400);
  });
});

describe('AC7: the audit log', () => {
  it('lists entries and offers no way to change them', async () => {
    const { user } = await adminIn(h);
    const { appId } = await someApp();
    await user.post(`/admin/api/apps/${appId}/plan`, { plan: 'premium', reason: 'for the log' });
    const list = await (await user.get('/admin/api/audit')).json();
    expect(list[0]).toMatchObject({ action: 'app.plan', reason: 'for the log' });
    const entryId = (await audit())[0]!._id;
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${h.url}/admin/api/audit/${entryId}`, { method, headers: { cookie: [...user.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': user.cookies.get('csrf_token')! } });
      expect(res.status).toBe(404);
    }
    expect(await h.admin.audit.countDocuments({ _id: entryId })).toBe(1);
  });
});

describe('F18 emails from the admin and payment paths', () => {
  const sentTo = (to: string, subject: RegExp) => h.sent.filter((mail) => mail.to === to && subject.test(mail.subject));

  it('AC7: disabling a user emails them once, with text and HTML', async () => {
    const { user } = await adminIn(h);
    const victimEmail = email();
    const victim = await signedIn(h, victimEmail);
    const victimId = (await h.users.findOne({ email: victimEmail }))!._id;
    await user.post(`/admin/api/users/${victimId}/disable`, why);
    await vi.waitFor(() => expect(sentTo(victimEmail, /account was disabled/i)).toHaveLength(1));
    expect(sentTo(victimEmail, /account was disabled/i)[0]!.html).toContain('Your account was disabled');
    void victim;
  });

  it('AC4: a refund emails the buyer exactly once', async () => {
    const { user } = await adminIn(h);
    const { user: buyer, appId } = await someApp();
    const { id } = await (await buyer.post('/payments/checkout', { appId })).json();
    const buyerEmail = email();
    await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'paid', paidAt: new Date(), paymentId: `pay_${id}`, receiptNo: 'R-000042', receipt: { buyerEmail, appName: 'Shop' } } });
    await Promise.all([user.post(`/admin/api/orders/${id}/refund`, why), user.post(`/admin/api/orders/${id}/refund`, why)]);
    await vi.waitFor(() => expect(sentTo(buyerEmail, /Refund for receipt R-000042/)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sentTo(buyerEmail, /Refund for receipt/)).toHaveLength(1);
  });

  it('AC8: a mail provider that is down does not break a refund or a disable', async () => {
    const { user } = await adminIn(h);
    const real = h.payments.mailer;
    const realAuth = h.admin.auth.mailer;
    const down = { send: async () => { throw new Error('provider down to a@secret.test'); } };
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.join(' ')));
    try {
      (h.payments as { mailer?: unknown }).mailer = down;
      (h.admin.auth as { mailer: unknown }).mailer = down;
      const { user: buyer, appId } = await someApp();
      const { id } = await (await buyer.post('/payments/checkout', { appId })).json();
      await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'paid', paidAt: new Date(), paymentId: `pay_${id}`, receipt: { buyerEmail: 'a@secret.test', appName: 'Shop' } } });
      expect((await user.post(`/admin/api/orders/${id}/refund`, why)).status).toBe(200);
      const victimEmail = email();
      await signedIn(h, victimEmail);
      const victimId = (await h.users.findOne({ email: victimEmail }))!._id;
      expect((await user.post(`/admin/api/users/${victimId}/disable`, why)).status).toBe(204);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(errors.join('\n')).not.toContain('secret.test');
    } finally {
      spy.mockRestore();
      (h.payments as { mailer?: unknown }).mailer = real;
      (h.admin.auth as { mailer: unknown }).mailer = realAuth;
    }
  });
});
