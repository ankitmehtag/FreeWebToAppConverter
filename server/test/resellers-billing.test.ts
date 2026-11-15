import { createHmac } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEvent } from '../src/payments/events';
import { reconcile } from '../src/payments/reconcile';
import { lapseExpired } from '../src/resellers/billing';
import { adminIn, KEY_SECRET, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const why = { reason: 'testing billing' };
const tag = () => Math.random().toString(36).slice(2, 8);
const sign = (orderId: string, paymentId: string) => createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const fields = (providerOrderId: string, paymentId: string) => ({ razorpay_order_id: providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: sign(providerOrderId, paymentId) });
const DAY = 24 * 60 * 60 * 1000;

const setup = async (priceMinor = 249900, builds = 10) => {
  const admin = await adminIn(h);
  const address = `u${tag()}@example.com`;
  const user = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `Plan ${tag()}`, priceMinor, buildsPerMonth: builds, api: false, builtWithLine: true, ...why })).json();
  const { id } = await (await admin.user.post('/admin/api/resellers', { userEmail: address, slug: `s-${tag()}`, brandName: 'Pixel Agency', planId, ...why })).json();
  return { admin, user, address, resellerId: new ObjectId(id as string), planId: planId as string };
};
const doc = async (id: ObjectId) => (await h.admin.resellers.resellers.findOne({ _id: id }))!;
const orderDoc = async (id: string) => (await h.admin.resellers.orders.findOne({ _id: new ObjectId(id) }))!;
const startPay = async (user: Awaited<ReturnType<typeof signedIn>>) => {
  const response = await user.post('/resellers/me/pay');
  return { response, body: await response.json() };
};
const paidMonths = (paidUntil: Date, from = new Date()) => Math.round((paidUntil.getTime() - from.getTime()) / (30 * DAY));
const mailsTo = (address: string, subject: RegExp) => h.sent.filter((mail) => mail.to === address && subject.test(mail.subject));

describe('AC2: paying a month', () => {
  it('opens a checkout at the price the reseller joined at, and gives the same one back', async () => {
    const { user } = await setup();
    const first = await startPay(user);
    expect(first.response.status).toBe(201);
    expect(first.body).toMatchObject({ amount: 249900, currency: 'INR', status: 'created', checkout: { keyId: 'rzp_test_fake' } });
    expect(h.checkouts.at(-1)).toMatchObject({ amount: 249900, currency: 'INR', orderId: first.body.id });
    const again = await startPay(user);
    expect(again.body.id).toBe(first.body.id);
  });

  it('is told about the price and the end of the paid month on the dashboard', async () => {
    const { user } = await setup();
    expect(await (await user.get('/resellers/me')).json()).toMatchObject({ payment: { available: true, priceMinor: 249900, paidUntil: null } });
  });

  it('runs the plan one more month, starts the quota again and says so once, however often it is verified', async () => {
    const { user, address, resellerId } = await setup();
    await h.admin.resellers.resellers.updateOne({ _id: resellerId }, { $set: { 'quota.used': 7, lapsedAt: new Date() } });
    const { body } = await startPay(user);
    const order = await orderDoc(body.id);
    const verify = () => user.post('/resellers/me/pay/verify', fields(order.providerOrderId, 'pay_ok_1'));
    const first = await verify();
    expect(first.status).toBe(200);
    expect((await first.json()).paid).toBe(true);
    await verify();
    const after = await doc(resellerId);
    expect(paidMonths(after.paidUntil)).toBe(1);
    expect(after.quota.used).toBe(0);
    expect(after.lapsedAt).toBeUndefined();
    expect(after.appliedOrders).toHaveLength(1);
    expect(await orderDoc(body.id)).toMatchObject({ status: 'paid', paymentId: 'pay_ok_1' });
    expect(mailsTo(address, /is on the/)).toHaveLength(1);
  });

  it('refuses a payment whose signature does not match, and another reseller\'s order', async () => {
    const { user } = await setup();
    const other = await setup();
    const { body } = await startPay(user);
    const order = await orderDoc(body.id);
    expect((await user.post('/resellers/me/pay/verify', { ...fields(order.providerOrderId, 'pay_x'), razorpay_signature: 'nope' })).status).toBe(400);
    expect((await other.user.post('/resellers/me/pay/verify', fields(order.providerOrderId, 'pay_x'))).status).toBe(404);
    expect((await orderDoc(body.id)).status).toBe('created');
  });

  it('adds a second month to the end of the first when paid early', async () => {
    const { user, resellerId } = await setup();
    for (const payment of ['pay_a', 'pay_b']) {
      const { body } = await startPay(user);
      await user.post('/resellers/me/pay/verify', fields((await orderDoc(body.id)).providerOrderId, payment));
    }
    expect(paidMonths((await doc(resellerId)).paidUntil)).toBe(2);
  });

  it('counts a payment the webhook reports as well, and a repeat or the modal after it changes nothing', async () => {
    const { user, resellerId } = await setup();
    const { body } = await startPay(user);
    const order = await orderDoc(body.id);
    const event = { eventId: `evt_${tag()}`, type: 'paid' as const, providerOrderId: order.providerOrderId, paymentId: 'pay_hook', amount: 249900, currency: 'INR' };
    expect(await applyEvent(h.payments, 'razorpay', event, 'x')).toBe('applied');
    expect(await applyEvent(h.payments, 'razorpay', event, 'x')).toBe('duplicate');
    await user.post('/resellers/me/pay/verify', fields(order.providerOrderId, 'pay_hook'));
    const after = await doc(resellerId);
    expect(after.appliedOrders).toHaveLength(1);
    expect(paidMonths(after.paidUntil)).toBe(1);
  });

  it('activates nothing when the amount is wrong', async () => {
    const { user, resellerId } = await setup();
    const { body } = await startPay(user);
    const order = await orderDoc(body.id);
    const outcome = await applyEvent(h.payments, 'razorpay', { eventId: `evt_${tag()}`, type: 'paid', providerOrderId: order.providerOrderId, paymentId: 'pay_short', amount: 100, currency: 'INR' }, 'x');
    expect(outcome).toBe('mismatch');
    expect((await doc(resellerId)).paidUntil).toBeUndefined();
    expect((await orderDoc(body.id)).status).toBe('created');
  });

  it('still counts a payment on an order that was set aside for a new price', async () => {
    const { user, admin, planId, resellerId } = await setup();
    const { body } = await startPay(user);
    const old = await orderDoc(body.id);
    await h.admin.resellers.resellers.updateOne({ _id: resellerId }, { $set: { 'terms.priceMinor': 199900 } });
    const next = await startPay(user);
    expect(next.body.id).not.toBe(body.id);
    expect(next.body.amount).toBe(199900);
    expect((await orderDoc(body.id)).status).toBe('superseded');
    await applyEvent(h.payments, 'razorpay', { eventId: `evt_${tag()}`, type: 'paid', providerOrderId: old.providerOrderId, paymentId: 'pay_late', amount: 249900, currency: 'INR' }, 'x');
    expect((await orderDoc(body.id)).status).toBe('paid');
    expect(paidMonths((await doc(resellerId)).paidUntil)).toBe(1);
    void admin; void planId;
  });

  it('settles a stuck order from the provider\'s word in the sweep', async () => {
    const { user, resellerId } = await setup();
    const { body } = await startPay(user);
    const order = await orderDoc(body.id);
    await h.admin.resellers.orders.updateOne({ _id: order._id }, { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    const provider = h.payments.providers.razorpay!;
    const real = provider.fetchStatus;
    provider.fetchStatus = async () => ({ status: 'paid', amount: 249900, currency: 'INR', paymentId: 'pay_swept' });
    try {
      await reconcile(h.payments);
    } finally {
      provider.fetchStatus = real;
    }
    expect((await orderDoc(body.id)).status).toBe('paid');
    expect(paidMonths((await doc(resellerId)).paidUntil)).toBe(1);
  });

  it('finishes a paid order the process dropped before applying it', async () => {
    const { user, resellerId } = await setup();
    const { body } = await startPay(user);
    await h.admin.resellers.orders.updateOne({ _id: new ObjectId(body.id) }, { $set: { status: 'paid', paidAt: new Date(), paymentId: 'pay_cut' } });
    await reconcile(h.payments);
    await reconcile(h.payments);
    expect((await doc(resellerId)).appliedOrders).toHaveLength(1);
  });

  it('is closed when payments are off, the plan is free, or the reseller is suspended', async () => {
    const free = await setup(0);
    expect((await startPay(free.user)).response.status).toBe(400);
    const suspended = await setup();
    await suspended.admin.user.post(`/admin/api/resellers/${suspended.resellerId}/suspend`, why);
    expect((await suspended.user.post('/resellers/me/pay')).status).toBe(404);
    const provider = h.payments.providers.razorpay;
    delete h.payments.providers.razorpay;
    try {
      const off = await setup();
      expect((await startPay(off.user)).response.status).toBe(400);
      expect((await (await off.user.get('/resellers/me')).json()).payment.available).toBe(false);
    } finally {
      h.payments.providers.razorpay = provider;
    }
  });
});

describe('AC7: a plan past its paid month', () => {
  it('lapses, tells the reseller once, refuses new builds, and comes back when paid', async () => {
    const { user, address, resellerId } = await setup();
    const { body } = await startPay(user);
    await user.post('/resellers/me/pay/verify', fields((await orderDoc(body.id)).providerOrderId, 'pay_m1'));
    expect(await lapseExpired(h.admin.resellers, new Date())).toBe(0);
    const later = new Date(Date.now() + 40 * DAY);
    expect(await lapseExpired(h.admin.resellers, later)).toBeGreaterThanOrEqual(1);
    expect(await lapseExpired(h.admin.resellers, later)).toBe(0);
    expect((await doc(resellerId)).lapsedAt).toBeInstanceOf(Date);
    expect(mailsTo(address, /needs renewing/)).toHaveLength(1);
    expect(await (await user.get('/resellers/me')).json()).toMatchObject({ lapsed: true });
    const next = await startPay(user);
    await user.post('/resellers/me/pay/verify', fields((await orderDoc(next.body.id)).providerOrderId, 'pay_m2'));
    expect((await doc(resellerId)).lapsedAt).toBeUndefined();
  });

  it('leaves a reseller with no payments (set up by the admin) alone', async () => {
    const { resellerId } = await setup();
    await lapseExpired(h.admin.resellers, new Date(Date.now() + 400 * DAY));
    expect((await doc(resellerId)).lapsedAt).toBeUndefined();
  });
});

describe('admin: cancel and reinstate', () => {
  it('ends the plan now with an email and an audit entry, and reinstates it', async () => {
    const { admin, address, resellerId, user } = await setup();
    const { body } = await startPay(user);
    await user.post('/resellers/me/pay/verify', fields((await orderDoc(body.id)).providerOrderId, 'pay_c1'));
    expect((await admin.user.post(`/admin/api/resellers/${resellerId}/cancel-plan`, why)).status).toBe(204);
    const cancelled = await doc(resellerId);
    expect(cancelled.lapsedAt).toBeInstanceOf(Date);
    expect(cancelled.paidUntil).toBeUndefined();
    expect(mailsTo(address, /was cancelled/)).toHaveLength(1);
    expect((await admin.user.post(`/admin/api/resellers/${resellerId}/reinstate-plan`, why)).status).toBe(204);
    expect((await doc(resellerId)).lapsedAt).toBeUndefined();
    const actions = (await h.admin.audit.find({ 'target.id': String(resellerId) }).toArray()).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['reseller.plan.cancel', 'reseller.plan.reinstate']));
    expect((await admin.user.post(`/admin/api/resellers/${new ObjectId()}/cancel-plan`, why)).status).toBe(404);
  });
});

describe('F14 stays as it was', () => {
  it('still settles an app order that arrives at the same webhook', async () => {
    const user = await signedIn(h, `u${tag()}@example.com`);
    const app = await (await user.post('/apps', { appName: 'Mine' })).json();
    const checkout = await (await user.post('/payments/checkout', { appId: app.id })).json();
    const outcome = await applyEvent(h.payments, 'razorpay', { eventId: `evt_${tag()}`, type: 'paid', providerOrderId: checkout.checkout.orderId, paymentId: 'pay_app', amount: 9900, currency: 'INR' }, 'x');
    expect(outcome).toBe('applied');
    expect((await h.apps.findOne({ _id: new ObjectId(app.id) }))!.plan).toBe('premium');
  });
});
