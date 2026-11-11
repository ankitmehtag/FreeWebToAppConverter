import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEvent } from '../src/payments/events';
import { reconcile } from '../src/payments/reconcile';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const code = () => `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const DAY = 24 * 60 * 60 * 1000;

const addCoupon = async (extra: object = {}) => {
  const c = code();
  await h.payments.coupons.insertOne({ code: c, kind: 'percent', percent: 100, plan: 'premium', expiresAt: new Date(Date.now() + DAY), maxUses: 10, perUserLimit: 1, used: 0, ...extra });
  return c;
};
const withApp = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Mine' })).json();
  return { user, appId: String(app.id) };
};
const used = async (c: string) => (await h.payments.coupons.findOne({ code: c }))?.used;
const planOf = async (appId: string) => (await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan;

describe('R17: a coupon\'s price effect', () => {
  it('takes a percentage off', async () => {
    const c = await addCoupon({ percent: 50 });
    const { user, appId } = await withApp();
    const body = await (await user.post('/payments/checkout', { appId, couponCode: c })).json();
    expect(body).toMatchObject({ amount: 4950, status: 'created' });
    expect(h.checkouts.at(-1)?.amount).toBe(4950);
    expect(await h.orders.findOne({ _id: new ObjectId(body.id) })).toMatchObject({ couponCode: c, listAmount: 9900 });
  });

  it('takes a flat amount off in the order\'s currency and never goes below zero', async () => {
    const c = await addCoupon({ kind: 'flat', flat: { INR: 5000 } });
    const { user, appId } = await withApp();
    expect((await (await user.post('/payments/checkout', { appId, couponCode: c })).json()).amount).toBe(4900);
    const big = await addCoupon({ kind: 'flat', flat: { INR: 50000 } });
    const other = await withApp();
    const free = await other.user.post('/payments/checkout', { appId: other.appId, couponCode: big });
    expect((await free.json()).status).toBe('paid');
  });

  it('is case-insensitive and shows the price on the check endpoint', async () => {
    const c = await addCoupon({ percent: 10 });
    const { user } = await withApp();
    const response = await user.post('/payments/coupon', { code: ` ${c.toLowerCase()} ` });
    expect(await response.json()).toEqual({ code: c, currency: 'INR', amount: 8910 });
  });

  it('answers the same for an unknown, expired, used-up, wrong-plan and wrong-currency code', async () => {
    const { user, appId } = await withApp();
    const bad = [
      'NOSUCH',
      await addCoupon({ expiresAt: new Date(Date.now() - DAY) }),
      await addCoupon({ maxUses: 1, used: 1 }),
      await addCoupon({ plan: 'gold' }),
      await addCoupon({ kind: 'flat', flat: { USD: 50 } }),
    ];
    for (const c of bad) {
      const check = await user.post('/payments/coupon', { code: c });
      expect([check.status, (await check.json()).error]).toEqual([404, 'That code doesn’t work']);
      expect((await user.post('/payments/checkout', { appId, couponCode: c })).status).toBe(400);
    }
    expect(await h.orders.countDocuments({ appId: new ObjectId(appId) })).toBe(0);
  });

  it('refuses a code that would leave a charge too small for the provider', async () => {
    const c = await addCoupon({ kind: 'flat', flat: { INR: 9850 } });
    const { user, appId } = await withApp();
    expect((await user.post('/payments/checkout', { appId, couponCode: c })).status).toBe(400);
  });
});

describe('AC11: the last use goes to exactly one buyer', () => {
  it('lets only one of two buyers redeem a coupon with one use left', async () => {
    const c = await addCoupon({ maxUses: 1, percent: 50 });
    const [a, b] = await Promise.all([withApp(), withApp()]);
    const results = await Promise.all([a, b].map(({ user, appId }) => user.post('/payments/checkout', { appId, couponCode: c })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await used(c)).toBe(1);
  });

  it('stays at the limit when many redeem at once', async () => {
    const c = await addCoupon({ maxUses: 3, percent: 50 });
    const buyers = await Promise.all([1, 2, 3, 4, 5, 6].map(() => withApp()));
    const results = await Promise.all(buyers.map(({ user, appId }) => user.post('/payments/checkout', { appId, couponCode: c })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await used(c)).toBe(3);
  });

  it('holds the per-user limit across apps and across concurrent requests', async () => {
    const c = await addCoupon({ percent: 50, perUserLimit: 1 });
    const user = await signedIn(h, email());
    const apps = await Promise.all([1, 2, 3].map(async () => String((await (await user.post('/apps', { appName: 'X' })).json()).id)));
    const results = await Promise.all(apps.map((appId) => user.post('/payments/checkout', { appId, couponCode: c })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await used(c)).toBe(1);
  });
});

describe('the use comes back when the order ends unpaid', () => {
  it('releases it when the provider fails at checkout', async () => {
    const c = await addCoupon({ percent: 50, maxUses: 1 });
    const { user, appId } = await withApp();
    const original = h.payments.providers.razorpay!.createCheckout;
    h.payments.providers.razorpay!.createCheckout = async () => { throw new Error('boom'); };
    expect((await user.post('/payments/checkout', { appId, couponCode: c })).status).toBe(502);
    h.payments.providers.razorpay!.createCheckout = original;
    expect(await used(c)).toBe(0);
    expect((await user.post('/payments/checkout', { appId, couponCode: c })).status).toBe(201);
  });

  it('releases it once when a payment fails, even if the event repeats', async () => {
    const c = await addCoupon({ percent: 50, maxUses: 5 });
    const { user, appId } = await withApp();
    const { id } = await (await user.post('/payments/checkout', { appId, couponCode: c })).json();
    const providerOrderId = (await h.orders.findOne({ _id: new ObjectId(id) }))!.providerOrderId as string;
    await applyEvent(h.payments, 'razorpay', { eventId: `f1_${id}`, type: 'failed', providerOrderId }, 'x');
    await applyEvent(h.payments, 'razorpay', { eventId: `f2_${id}`, type: 'failed', providerOrderId }, 'x');
    expect(await used(c)).toBe(0);
  });

  it('releases it when the sweep closes an abandoned order', async () => {
    const c = await addCoupon({ percent: 50, maxUses: 5 });
    const { user, appId } = await withApp();
    const { id } = await (await user.post('/payments/checkout', { appId, couponCode: c })).json();
    await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - 2 * 3600 * 1000) } });
    h.payments.providers.razorpay!.fetchStatus = async () => ({ status: 'expired', amount: 4950, currency: 'INR' });
    await reconcile(h.payments);
    expect(await used(c)).toBe(0);
  });

  it('keeps the use when the order is paid', async () => {
    const c = await addCoupon({ percent: 50, maxUses: 5 });
    const { user, appId } = await withApp();
    const { id } = await (await user.post('/payments/checkout', { appId, couponCode: c })).json();
    const providerOrderId = (await h.orders.findOne({ _id: new ObjectId(id) }))!.providerOrderId as string;
    await applyEvent(h.payments, 'razorpay', { eventId: `p_${id}`, type: 'paid', providerOrderId, paymentId: `pay_${id}`, amount: 4950, currency: 'INR' }, 'x');
    expect(await used(c)).toBe(1);
    expect(await planOf(appId)).toBe('premium');
  });
});

describe('AC12: a 100 percent coupon unlocks with no provider call', () => {
  it('makes a paid order, unlocks the app and calls no provider', async () => {
    const c = await addCoupon({ percent: 100 });
    const { user, appId } = await withApp();
    const before = h.checkouts.length;
    const response = await user.post('/payments/checkout', { appId, couponCode: c });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'paid', amount: 0, checkoutUrl: null });
    expect(h.checkouts.length).toBe(before);
    expect(await h.orders.findOne({ _id: new ObjectId(body.id) })).toMatchObject({ provider: 'coupon', status: 'paid', couponCode: c, couponRedeemed: true });
    expect(await planOf(appId)).toBe('premium');
    expect(await used(c)).toBe(1);
  });

  it('works even with no payment provider set up', async () => {
    const c = await addCoupon({ percent: 100 });
    const { user, appId } = await withApp();
    const saved = h.payments.providers.razorpay;
    delete h.payments.providers.razorpay;
    const response = await user.post('/payments/checkout', { appId, couponCode: c });
    h.payments.providers.razorpay = saved;
    expect(response.status).toBe(201);
    expect(await planOf(appId)).toBe('premium');
  });

  it('cannot be used twice by the same user for the same coupon', async () => {
    const c = await addCoupon({ percent: 100 });
    const user = await signedIn(h, email());
    const one = String((await (await user.post('/apps', { appName: 'A' })).json()).id);
    const two = String((await (await user.post('/apps', { appName: 'B' })).json()).id);
    expect((await user.post('/payments/checkout', { appId: one, couponCode: c })).status).toBe(201);
    expect((await user.post('/payments/checkout', { appId: two, couponCode: c })).status).toBe(409);
    expect(await planOf(two)).toBeUndefined();
  });

  it('finishes a free order whose unlock was cut off, from the sweep', async () => {
    const c = await addCoupon({ percent: 100 });
    const { appId } = await withApp();
    const orderId = new ObjectId();
    await h.orders.insertOne({ _id: orderId, appId: new ObjectId(appId), userId: new ObjectId(), plan: 'premium', provider: 'coupon', currency: 'INR', amount: 0, status: 'created', couponCode: c, couponRedeemed: true, createdAt: new Date(Date.now() - 2 * 3600 * 1000) });
    await reconcile(h.payments);
    expect((await h.orders.findOne({ _id: orderId }))?.status).toBe('paid');
    expect(await planOf(appId)).toBe('premium');
  });
});
