import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcile } from '../src/payments/reconcile';
import type { ProviderStatus } from '../src/payments/provider';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const MIN = 60 * 1000;

/** An order of this age, as left behind when no webhook arrived. */
const stuck = async (ageMs: number, extra: object = {}) => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Stuck' })).json();
  const { id } = await (await user.post('/payments/checkout', { appId: app.id })).json();
  await h.orders.updateOne({ _id: new ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - ageMs), ...extra } });
  return { appId: String(app.id), orderId: new ObjectId(id) };
};
const answer = (status: ProviderStatus) => { h.payments.providers.razorpay!.fetchStatus = async () => status; };
const planOf = async (appId: string) => (await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan;
const statusOf = async (orderId: ObjectId) => (await h.orders.findOne({ _id: orderId }))?.status;

describe('AC9: stuck orders are fixed from the provider\'s real status', () => {
  it('pays an order the provider says is paid and unlocks the app', async () => {
    const { appId, orderId } = await stuck(45 * MIN);
    answer({ status: 'paid', amount: 9900, currency: 'INR', paymentId: 'pay_rec_1' });
    expect(await reconcile(h.payments)).toMatchObject({ checked: expect.any(Number), paid: 1 });
    expect(await h.orders.findOne({ _id: orderId })).toMatchObject({ status: 'paid', paymentId: 'pay_rec_1' });
    expect(await planOf(appId)).toBe('premium');
  });

  it('is safe to run twice and does not repeat the unlock', async () => {
    const { appId, orderId } = await stuck(45 * MIN);
    answer({ status: 'paid', amount: 9900, currency: 'INR', paymentId: 'pay_rec_2' });
    await reconcile(h.payments);
    await reconcile(h.payments);
    expect(await statusOf(orderId)).toBe('paid');
    expect(await planOf(appId)).toBe('premium');
    expect(await h.db.collection('providerEvents').countDocuments({ eventId: `reconcile:${orderId}` })).toBe(1);
  });

  it('leaves an order younger than 30 minutes alone', async () => {
    const { appId, orderId } = await stuck(5 * MIN);
    answer({ status: 'paid', amount: 9900, currency: 'INR', paymentId: 'pay_rec_3' });
    await reconcile(h.payments);
    expect(await statusOf(orderId)).toBe('created');
    expect(await planOf(appId)).toBeUndefined();
  });

  it('keeps waiting while the provider says unpaid', async () => {
    const { orderId } = await stuck(45 * MIN);
    answer({ status: 'created', amount: 9900, currency: 'INR' });
    await reconcile(h.payments);
    expect(await statusOf(orderId)).toBe('created');
  });

  it('closes an expired link as failed so the app can be bought again', async () => {
    const { user, appId, orderId } = await (async () => {
      const made = await stuck(45 * MIN);
      return { ...made, user: null as never };
    })();
    void user;
    answer({ status: 'expired', amount: 9900, currency: 'INR' });
    await reconcile(h.payments);
    expect(await statusOf(orderId)).toBe('failed');
    expect(await planOf(appId)).toBeUndefined();
  });

  it('does not unlock when the provider reports a different amount', async () => {
    const { appId, orderId } = await stuck(45 * MIN);
    answer({ status: 'paid', amount: 100, currency: 'INR', paymentId: 'pay_rec_4' });
    await reconcile(h.payments);
    expect(await statusOf(orderId)).toBe('created');
    expect(await planOf(appId)).toBeUndefined();
  });

  it('fails an order that never reached the provider', async () => {
    const { orderId } = await stuck(45 * MIN);
    await h.orders.updateOne({ _id: orderId }, { $unset: { providerOrderId: '', checkoutUrl: '' } });
    await reconcile(h.payments);
    expect(await statusOf(orderId)).toBe('failed');
  });

  it('keeps going when the provider fails for one order', async () => {
    const bad = await stuck(45 * MIN);
    const good = await stuck(45 * MIN);
    h.payments.providers.razorpay!.fetchStatus = async (providerOrderId) => {
      if (providerOrderId === (await h.orders.findOne({ _id: bad.orderId }))?.providerOrderId) throw new Error('Razorpay answered 500');
      return { status: 'paid', amount: 9900, currency: 'INR', paymentId: 'pay_rec_5' };
    };
    const result = await reconcile(h.payments);
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(await statusOf(bad.orderId)).toBe('created');
    expect(await statusOf(good.orderId)).toBe('paid');
  });

  it('repairs a paid order whose app is still Free', async () => {
    const { appId, orderId } = await stuck(45 * MIN, { status: 'paid', paymentId: 'pay_rec_6' });
    expect(await planOf(appId)).toBeUndefined();
    await reconcile(h.payments);
    expect(await planOf(appId)).toBe('premium');
    expect(await statusOf(orderId)).toBe('paid');
  });
});
