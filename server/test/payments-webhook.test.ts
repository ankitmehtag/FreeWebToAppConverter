import { createHmac } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_SECRET, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

/** An app with an open order, as after the buyer reached the payment page. */
const withOrder = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Mine' })).json();
  const order = await (await user.post('/payments/checkout', { appId: app.id })).json();
  const stored = await h.orders.findOne({ _id: new ObjectId(order.id) });
  return { user, appId: String(app.id), orderId: String(order.id), providerOrderId: String(stored!.providerOrderId) };
};
const planOf = async (appId: string) => (await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan;

const paidBody = (providerOrderId: string, amount = 9900, currency = 'INR') =>
  JSON.stringify({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: providerOrderId, amount, amount_paid: amount, currency } }, payment: { entity: { id: `pay_${providerOrderId}`, amount, currency } } },
  });
const sign = (body: string, secret = WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');
const send = (body: string, { eventId = `evt_${Math.random()}`, signature = sign(body) }: { eventId?: string; signature?: string | null } = {}) =>
  fetch(`${h.url}/payments/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-event-id': eventId, ...(signature ? { 'x-razorpay-signature': signature } : {}) },
    body,
  });

describe('AC4: a webhook without a good signature changes nothing', () => {
  it('rejects a missing signature, a wrong one and a wrong secret', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    const body = paidBody(providerOrderId);
    for (const signature of [null, 'abcd', sign(body, 'someone-elses-secret'), sign(body).slice(0, -2) + '00']) {
      const response = await send(body, { signature });
      expect(response.status).toBe(400);
    }
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('created');
    expect(await planOf(appId)).toBeUndefined();
    expect(await h.db.collection('providerEvents').countDocuments({})).toBe(0);
  });

  it('rejects a body that was changed after signing', async () => {
    const { appId, providerOrderId } = await withOrder();
    const body = paidBody(providerOrderId);
    const signed = sign(body);
    expect((await send(paidBody(providerOrderId, 1), { signature: signed })).status).toBe(400);
    expect(await planOf(appId)).toBeUndefined();
  });

  it('needs no session or CSRF token when the signature is good', async () => {
    const { providerOrderId } = await withOrder();
    expect((await send(paidBody(providerOrderId))).status).toBe(200);
  });
});

describe('AC5: a repeated event is a no-op', () => {
  it('pays the order once and answers 200 both times', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    const body = paidBody(providerOrderId);
    const first = await send(body, { eventId: 'evt_same' });
    const again = await send(body, { eventId: 'evt_same' });
    expect([first.status, again.status]).toEqual([200, 200]);
    const order = await h.orders.findOne({ _id: new ObjectId(orderId) });
    expect(order).toMatchObject({ status: 'paid', paymentId: `pay_${providerOrderId}` });
    expect(await planOf(appId)).toBe('premium');
    expect(await h.db.collection('providerEvents').countDocuments({ eventId: 'evt_same' })).toBe(1);
  });

  it('shows the paid order to the buyer', async () => {
    const { user, orderId, providerOrderId } = await withOrder();
    await send(paidBody(providerOrderId));
    expect((await (await user.get(`/payments/orders/${orderId}`)).json()).status).toBe('paid');
  });

  it('handles two copies arriving at once', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    const body = paidBody(providerOrderId);
    const results = await Promise.all([1, 2, 3].map(() => send(body, { eventId: 'evt_race' })));
    expect(results.every((response) => response.status === 200)).toBe(true);
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('paid');
    expect(await planOf(appId)).toBe('premium');
  });
});

describe('AC6: the amount and currency must match the order', () => {
  it('keeps the app Free and logs a mismatch', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    for (const body of [paidBody(providerOrderId, 100), paidBody(providerOrderId, 9900, 'USD')]) {
      expect((await send(body)).status).toBe(200);
    }
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('created');
    expect(await planOf(appId)).toBeUndefined();
    expect(await h.db.collection('providerEvents').countDocuments({ outcome: 'mismatch' })).toBeGreaterThanOrEqual(2);
  });
});

describe('an event for an order we cannot match yet', () => {
  it('asks the provider to retry and succeeds when the order appears', async () => {
    const body = paidBody('plink_not_yet');
    expect((await send(body, { eventId: 'evt_early' })).status).toBe(503);
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Late' })).json();
    await h.orders.insertOne({ appId: new ObjectId(app.id), userId: new ObjectId(), plan: 'premium', provider: 'razorpay', providerOrderId: 'plink_not_yet', currency: 'INR', amount: 9900, status: 'created', createdAt: new Date() });
    expect((await send(body, { eventId: 'evt_early' })).status).toBe(200);
    expect(await planOf(String(app.id))).toBe('premium');
  });

  it('ignores events it does not act on', async () => {
    const body = JSON.stringify({ event: 'order.paid', payload: {} });
    expect((await send(body)).status).toBe(200);
  });
});

const refundBody = (paymentId: string, amount = 9900) =>
  JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: paymentId, amount } } } });

describe('AC7: a cut-off event ends consistent when it is retried', () => {
  it('finishes an event that was recorded but not applied', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    // The process died right after recording the event.
    await h.db.collection('providerEvents').insertOne({ provider: 'razorpay', eventId: 'evt_cut', type: 'paid', receivedAt: new Date() });
    expect(await planOf(appId)).toBeUndefined();
    expect((await send(paidBody(providerOrderId), { eventId: 'evt_cut' })).status).toBe(200);
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('paid');
    expect(await planOf(appId)).toBe('premium');
  });

  it('unlocks an app whose order was marked paid but whose plan was not set', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    await h.orders.updateOne({ _id: new ObjectId(orderId) }, { $set: { status: 'paid', paymentId: `pay_${providerOrderId}` } });
    expect(await planOf(appId)).toBeUndefined();
    expect((await send(paidBody(providerOrderId), { eventId: 'evt_half' })).status).toBe(200);
    expect(await planOf(appId)).toBe('premium');
  });
});

describe('AC8: events in any order', () => {
  it('ends Free when a refund arrives before the payment', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    expect((await send(refundBody(`pay_${providerOrderId}`), { eventId: 'evt_refund' })).status).toBe(503);
    expect((await send(paidBody(providerOrderId), { eventId: 'evt_paid' })).status).toBe(200);
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('refunded');
    expect(await planOf(appId)).not.toBe('premium');
    // The provider's retry of the refund finds the order and closes the event.
    expect((await send(refundBody(`pay_${providerOrderId}`), { eventId: 'evt_refund' })).status).toBe(200);
    expect(await planOf(appId)).not.toBe('premium');
  });

  it('returns a paid app to Free on a later refund', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    await send(paidBody(providerOrderId));
    expect(await planOf(appId)).toBe('premium');
    expect((await send(refundBody(`pay_${providerOrderId}`))).status).toBe(200);
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('refunded');
    expect(await planOf(appId)).toBe('free');
  });

  it('does not unlock again when the payment event is replayed after a refund', async () => {
    const { appId, providerOrderId } = await withOrder();
    await send(paidBody(providerOrderId), { eventId: 'evt_p1' });
    await send(refundBody(`pay_${providerOrderId}`));
    expect((await send(paidBody(providerOrderId), { eventId: 'evt_p2' })).status).toBe(200);
    expect(await planOf(appId)).toBe('free');
  });

  it('ignores a partial refund', async () => {
    const { appId, orderId, providerOrderId } = await withOrder();
    await send(paidBody(providerOrderId));
    expect((await send(refundBody(`pay_${providerOrderId}`, 500))).status).toBe(200);
    expect((await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status).toBe('paid');
    expect(await planOf(appId)).toBe('premium');
  });
});
