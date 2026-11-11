import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const withApp = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Mine' })).json();
  return { user, appId: String(app.id) };
};

describe('R2: prices come from the server', () => {
  it('answers the price list without a session and says where Premium can be bought', async () => {
    const body = await (await fetch(`${h.url}/payments/prices`)).json();
    expect(body).toEqual({ premium: { INR: 9900, USD: 100 }, available: ['INR'] });
  });
});

describe('AC1: checkout creates an order and sends the buyer to the provider', () => {
  it('creates a created order for the owner with the server price', async () => {
    const { user, appId } = await withApp();
    const response = await user.post('/payments/checkout', { appId });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ appId, plan: 'premium', status: 'created', currency: 'INR', amount: 9900 });
    expect(body.checkoutUrl).toBe(`https://pay.test/${body.id}`);
    const order = await h.orders.findOne({ _id: new ObjectId(body.id) });
    expect(order).toMatchObject({ provider: 'razorpay', providerOrderId: expect.any(String), status: 'created' });
    expect(h.checkouts.at(-1)).toMatchObject({ orderId: body.id, amount: 9900, currency: 'INR', returnUrl: expect.stringContaining(`/pay/return?order=${body.id}`) });
  });

  it('ignores a price sent by the browser', async () => {
    const { user, appId } = await withApp();
    const body = await (await user.post('/payments/checkout', { appId, amount: 1, price: 1 })).json();
    expect(body.amount).toBe(9900);
  });

  it('shows the order status from the server to its owner only', async () => {
    const { user, appId } = await withApp();
    const { id } = await (await user.post('/payments/checkout', { appId })).json();
    const read = await user.get(`/payments/orders/${id}`);
    expect(read.status).toBe(200);
    expect((await read.json()).status).toBe('created');
    const stranger = await signedIn(h, email());
    expect((await stranger.get(`/payments/orders/${id}`)).status).toBe(404);
  });

  it('needs a session and a CSRF token', async () => {
    const { user, appId } = await withApp();
    expect((await fetch(`${h.url}/payments/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId }) })).status).toBe(401);
    expect((await user.post('/payments/checkout', { appId }, { csrf: null })).status).toBe(403);
    expect(await h.orders.countDocuments({ appId: new ObjectId(appId) })).toBe(0);
  });

  it('fails a bad body and a currency with no provider, leaving no order', async () => {
    const { user, appId } = await withApp();
    expect((await user.post('/payments/checkout', { appId: 'nope' })).status).toBe(400);
    expect((await user.post('/payments/checkout', { appId, currency: 'EUR' })).status).toBe(400);
    expect((await user.post('/payments/checkout', { appId, currency: 'USD' })).status).toBe(400);
    expect(await h.orders.countDocuments({ appId: new ObjectId(appId) })).toBe(0);
  });

  it('frees the app for another try when the provider fails', async () => {
    const { user, appId } = await withApp();
    const original = h.payments.providers.razorpay!.createCheckout;
    h.payments.providers.razorpay!.createCheckout = async () => { throw new Error('Razorpay answered 500'); };
    const failed = await user.post('/payments/checkout', { appId });
    h.payments.providers.razorpay!.createCheckout = original;
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain('Razorpay answered');
    expect(await h.orders.findOne({ appId: new ObjectId(appId) })).toMatchObject({ status: 'failed' });
    expect((await user.post('/payments/checkout', { appId })).status).toBe(201);
  });
});

describe('AC2: a second checkout never makes a second charge', () => {
  it('reuses the open order and its link', async () => {
    const { user, appId } = await withApp();
    const first = await (await user.post('/payments/checkout', { appId })).json();
    const again = await user.post('/payments/checkout', { appId });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: first.id, checkoutUrl: first.checkoutUrl });
    expect(await h.orders.countDocuments({ appId: new ObjectId(appId) })).toBe(1);
  });

  it('keeps one order and one provider call when two requests arrive at once', async () => {
    const { user, appId } = await withApp();
    const before = h.checkouts.length;
    const results = await Promise.all([1, 2, 3].map(() => user.post('/payments/checkout', { appId })));
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(await h.orders.countDocuments({ appId: new ObjectId(appId) })).toBe(1);
    expect(h.checkouts.length - before).toBe(1);
  });

  it('refuses a paid order and an app that is already Premium', async () => {
    const { user, appId } = await withApp();
    const { id } = await (await user.post('/payments/checkout', { appId })).json();
    await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'paid' } });
    expect((await user.post('/payments/checkout', { appId })).status).toBe(409);
    await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'refunded' } });
    await h.apps.updateOne({ _id: new ObjectId(appId) }, { $set: { plan: 'premium' } });
    expect((await user.post('/payments/checkout', { appId })).status).toBe(409);
  });
});

describe('AC3: only the owner can buy for an app', () => {
  it('refuses another user\'s app and a missing app, with no order', async () => {
    const { appId } = await withApp();
    const stranger = await signedIn(h, email());
    expect((await stranger.post('/payments/checkout', { appId })).status).toBe(404);
    expect((await stranger.post('/payments/checkout', { appId: new ObjectId().toHexString() })).status).toBe(404);
    expect(await h.orders.countDocuments({ appId: new ObjectId(appId) })).toBe(0);
  });
});

describe('R24: checkout is rate limited per user', () => {
  it('stops one user after ten attempts but not another', async () => {
    const { user, appId } = await withApp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await user.post('/payments/checkout', { appId: 'bad' })).status);
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const other = await withApp();
    expect((await other.user.post('/payments/checkout', { appId: other.appId })).status).toBe(201);
    void appId;
  });
});
