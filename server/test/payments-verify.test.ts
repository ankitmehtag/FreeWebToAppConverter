import { createHmac } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEY_SECRET, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) => createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

const checkedOut = async () => {
  const address = email();
  const user = await signedIn(h, address);
  const app = await (await user.post('/apps', { appName: 'Modal' })).json();
  const body = await (await user.post('/payments/checkout', { appId: app.id })).json();
  return { user, address, appId: String(app.id), orderId: String(body.id), providerOrderId: String(body.checkout.orderId) };
};
const paymentFields = (providerOrderId: string, paymentId: string, signature = sign(providerOrderId, paymentId)) => ({
  razorpay_order_id: providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature,
});
const planOf = async (appId: string) => (await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan;
const statusOf = async (orderId: string) => (await h.orders.findOne({ _id: new ObjectId(orderId) }))?.status;

describe('AC1: the modal result is verified before anything is paid', () => {
  it('marks the order paid, unlocks the app and sends one receipt when the signature matches', async () => {
    const { user, address, appId, orderId, providerOrderId } = await checkedOut();
    const response = await user.post('/payments/verify', paymentFields(providerOrderId, 'pay_ok_1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: orderId, status: 'paid' });
    expect(await statusOf(orderId)).toBe('paid');
    expect(await planOf(appId)).toBe('premium');
    expect(await h.orders.findOne({ _id: new ObjectId(orderId) })).toMatchObject({ paymentId: 'pay_ok_1', receiptNo: expect.stringMatching(/^R-/) });
    expect(h.sent.filter((mail) => mail.to === address && /receipt/i.test(mail.subject))).toHaveLength(1);
  });

  it('returns 400 and marks nothing paid when the signature does not match', async () => {
    const { user, appId, orderId, providerOrderId } = await checkedOut();
    for (const signature of ['abcd', sign(providerOrderId, 'pay_x', 'wrong-secret'), sign('order_other', 'pay_x'), sign(providerOrderId, 'pay_other')]) {
      expect((await user.post('/payments/verify', paymentFields(providerOrderId, 'pay_x', signature))).status).toBe(400);
    }
    expect(await statusOf(orderId)).toBe('created');
    expect(await planOf(appId)).toBeUndefined();
  });

  it('returns 400 for missing or oversized fields', async () => {
    const { user, providerOrderId } = await checkedOut();
    const full = paymentFields(providerOrderId, 'pay_m');
    for (const field of Object.keys(full)) {
      expect((await user.post('/payments/verify', { ...full, [field]: undefined })).status).toBe(400);
      expect((await user.post('/payments/verify', { ...full, [field]: 'x'.repeat(500) })).status).toBe(400);
    }
    expect((await user.post('/payments/verify', {})).status).toBe(400);
  });

  it('is a no-op when the same payment is verified again', async () => {
    const { user, appId, address, providerOrderId } = await checkedOut();
    const fields = paymentFields(providerOrderId, 'pay_twice');
    expect((await user.post('/payments/verify', fields)).status).toBe(200);
    expect((await user.post('/payments/verify', fields)).status).toBe(200);
    expect(await planOf(appId)).toBe('premium');
    expect(h.sent.filter((mail) => mail.to === address && /receipt/i.test(mail.subject))).toHaveLength(1);
  });

  it('does not let another user verify an order that is not theirs', async () => {
    const { appId, orderId, providerOrderId } = await checkedOut();
    const stranger = await signedIn(h, email());
    expect((await stranger.post('/payments/verify', paymentFields(providerOrderId, 'pay_steal'))).status).toBe(404);
    expect(await statusOf(orderId)).toBe('created');
    expect(await planOf(appId)).toBeUndefined();
  });

  it('uses the order\'s own amount, not one the page sends', async () => {
    const { user, orderId, providerOrderId } = await checkedOut();
    await user.post('/payments/verify', { ...paymentFields(providerOrderId, 'pay_amt'), amount: 1, currency: 'USD' });
    expect(await h.orders.findOne({ _id: new ObjectId(orderId) })).toMatchObject({ status: 'paid', amount: 9900, currency: 'INR' });
  });

  it('does not unlock an order that was refunded first', async () => {
    const { user, appId, orderId, providerOrderId } = await checkedOut();
    await h.orders.updateOne({ _id: new ObjectId(orderId) }, { $set: { status: 'refunded' } });
    await user.post('/payments/verify', paymentFields(providerOrderId, 'pay_late'));
    expect(await statusOf(orderId)).toBe('refunded');
    expect(await planOf(appId)).toBeUndefined();
  });

  it('needs a session and a CSRF token', async () => {
    const { user, providerOrderId } = await checkedOut();
    const fields = paymentFields(providerOrderId, 'pay_auth');
    expect((await fetch(`${h.url}/payments/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) })).status).toBe(401);
    expect((await user.post('/payments/verify', fields, { csrf: null })).status).toBe(403);
  });
});
