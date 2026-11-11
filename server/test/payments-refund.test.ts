import { createHmac, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeystoreOnce } from '@sitetoapk/shared/keystore';
import { applyEvent } from '../src/payments/events';
import { refundOrder } from '../src/payments/refunds';
import { WEBHOOK_SECRET, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const DAY = 24 * 60 * 60 * 1000;
const secrets = { alias: 'app-1a2b3c', storePassword: 'STORE-PASS-xyz', keyPassword: 'STORE-PASS-xyz', keystore: Buffer.from('PKCS12-BYTES') };

/** A paid Premium app with a key and a finished build, as after a purchase and a first Premium build. */
const paidApp = async () => {
  const user = await signedIn(h, email());
  const app = await (await user.post('/apps', { appName: 'Paid' })).json();
  const appId = new ObjectId(app.id);
  const ownerId = (await h.apps.findOne({ _id: appId }))!.ownerId as ObjectId;
  const { id } = await (await user.post('/payments/checkout', { appId: app.id })).json();
  const orderId = new ObjectId(id);
  const paymentId = `pay_${id}`;
  await h.orders.updateOne({ _id: orderId }, { $set: { status: 'paid', paidAt: new Date(), paymentId } });
  await h.apps.updateOne({ _id: appId }, { $set: { plan: 'premium' } });
  await createKeystoreOnce(h.keystores, h.ring, appId, secrets, { sha1: 'AA', sha256: 'BB' }, ownerId);
  const buildId = randomUUID();
  await h.builds.insertOne({ _id: buildId as never, appId, ownerId, status: 'success', plan: 'premium', artifactKey: `premium/${buildId}.apk`, aabKey: `premium/${buildId}.aab`, expiresAt: null, createdAt: new Date() } as never);
  return { user, appId, orderId, paymentId, buildId, ownerId };
};
const order = (id: ObjectId) => h.orders.findOne({ _id: id });
const plan = async (id: ObjectId) => (await h.apps.findOne({ _id: id }))?.plan;

describe('AC10: the owner refunds a paid app', () => {
  it('refunds through the provider, then returns the app to Free', async () => {
    const { appId, orderId, paymentId } = await paidApp();
    const result = await refundOrder(h.payments, String(orderId));
    expect(result).toMatchObject({ ok: true, refundId: expect.stringContaining('rfnd_') });
    expect(h.refunds.at(-1)).toEqual({ paymentId, amount: 9900 });
    expect(await order(orderId)).toMatchObject({ status: 'refunded', refundId: expect.any(String) });
    expect(await plan(appId)).toBe('free');
  });

  it('keeps earlier builds downloadable until they expire', async () => {
    const { user, orderId, buildId } = await paidApp();
    await refundOrder(h.payments, String(orderId));
    expect((await user.get(`/builds/${buildId}/download`)).status).toBe(302);
    expect((await h.builds.findOne({ _id: buildId as never }))?.expiresAt).toBeNull();
  });

  it('revokes the key download', async () => {
    const { user, appId, orderId } = await paidApp();
    await refundOrder(h.payments, String(orderId));
    expect((await h.keystores.findOne({ appId }))?.revokedAt).toBeInstanceOf(Date);
    const response = await user.post(`/keystores/${appId}/download`, { confirm: true });
    expect(response.status).toBe(403);
  });

  it('lets the app be bought again after a refund', async () => {
    const { user, appId, orderId } = await paidApp();
    await refundOrder(h.payments, String(orderId));
    expect((await user.post('/payments/checkout', { appId: String(appId) })).status).toBe(201);
  });

  it('stays refunded when the provider\'s refund event arrives afterwards', async () => {
    const { appId, orderId, paymentId } = await paidApp();
    await refundOrder(h.payments, String(orderId));
    const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_x', payment_id: paymentId, amount: 9900 } } } });
    const response = await fetch(`${h.url}/payments/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-event-id': `evt_${paymentId}`, 'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex') },
      body,
    });
    expect(response.status).toBe(200);
    expect((await order(orderId))?.status).toBe('refunded');
    expect(await plan(appId)).toBe('free');
  });
});

describe('R14: the refund rules', () => {
  it('refuses an order that is not paid, unknown, or without a payment id', async () => {
    const { orderId } = await paidApp();
    expect(await refundOrder(h.payments, 'nope')).toMatchObject({ ok: false });
    expect(await refundOrder(h.payments, new ObjectId().toHexString())).toMatchObject({ ok: false, reason: 'No such order' });
    await h.orders.updateOne({ _id: orderId }, { $unset: { paymentId: '' } });
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: false, reason: expect.stringContaining('payment id') });
    await h.orders.updateOne({ _id: orderId }, { $set: { status: 'created' } });
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: false, reason: expect.stringContaining('not paid') });
  });

  it('refuses after 7 days unless forced', async () => {
    const { appId, orderId } = await paidApp();
    await h.orders.updateOne({ _id: orderId }, { $set: { paidAt: new Date(Date.now() - 8 * DAY) } });
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: false, reason: expect.stringContaining('7-day') });
    expect(await plan(appId)).toBe('premium');
    expect(await refundOrder(h.payments, String(orderId), { force: true })).toMatchObject({ ok: true });
    expect(await plan(appId)).toBe('free');
  });

  it('refuses once the key has been downloaded, unless forced', async () => {
    const { appId, orderId } = await paidApp();
    await h.keystores.updateOne({ appId }, { $set: { downloadedAt: new Date() } });
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: false, reason: expect.stringContaining('downloaded') });
    expect(await refundOrder(h.payments, String(orderId), { force: true })).toMatchObject({ ok: true });
  });

  it('refuses once the bundle has been downloaded, and the download route is what records it', async () => {
    const { user, buildId, orderId } = await paidApp();
    expect((await user.get(`/builds/${buildId}/download?file=aab`)).status).toBe(302);
    expect((await h.builds.findOne({ _id: buildId as never }))?.aabDownloadedAt).toBeInstanceOf(Date);
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: false, reason: expect.stringContaining('downloaded') });
  });

  it('does not count an APK download against the refund', async () => {
    const { user, buildId, orderId } = await paidApp();
    await user.get(`/builds/${buildId}/download`);
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: true });
  });

  it('leaves the order paid and the app Premium when the provider fails', async () => {
    const { appId, orderId } = await paidApp();
    const original = h.payments.providers.razorpay!.refund;
    h.payments.providers.razorpay!.refund = async () => { throw new Error('Razorpay answered 400'); };
    const result = await refundOrder(h.payments, String(orderId));
    h.payments.providers.razorpay!.refund = original;
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('provider refused') });
    expect((await order(orderId))?.status).toBe('paid');
    expect(await plan(appId)).toBe('premium');
  });

  it('refunds only once', async () => {
    const { orderId } = await paidApp();
    const before = h.refunds.length;
    await refundOrder(h.payments, String(orderId));
    expect(await refundOrder(h.payments, String(orderId))).toMatchObject({ ok: false });
    expect(h.refunds.length - before).toBe(1);
  });
});

describe('R14: a lost dispute and a failed payment', () => {
  it('returns the app to Free and revokes the key on a lost dispute', async () => {
    const { appId, orderId, paymentId } = await paidApp();
    const outcome = await applyEvent(h.payments, 'razorpay', { eventId: `evt_d_${paymentId}`, type: 'disputed', paymentId }, 'test');
    expect(outcome).toBe('applied');
    expect((await order(orderId))?.status).toBe('disputed');
    expect(await plan(appId)).toBe('free');
    expect((await h.keystores.findOne({ appId }))?.revokedAt).toBeInstanceOf(Date);
  });

  it('closes a waiting order whose payment failed, so the app can be bought again', async () => {
    const user = await signedIn(h, email());
    const app = await (await user.post('/apps', { appName: 'Failing' })).json();
    const { id } = await (await user.post('/payments/checkout', { appId: app.id })).json();
    const providerOrderId = (await order(new ObjectId(id)))!.providerOrderId as string;
    await applyEvent(h.payments, 'razorpay', { eventId: `evt_f_${id}`, type: 'failed', providerOrderId }, 'test');
    expect((await order(new ObjectId(id)))?.status).toBe('failed');
    expect((await user.post('/payments/checkout', { appId: app.id })).status).toBe(201);
  });

  it('does not touch a paid order on a failed event', async () => {
    const { orderId, appId } = await paidApp();
    const providerOrderId = (await order(orderId))!.providerOrderId as string;
    await applyEvent(h.payments, 'razorpay', { eventId: `evt_f2_${orderId}`, type: 'failed', providerOrderId }, 'test');
    expect((await order(orderId))?.status).toBe('paid');
    expect(await plan(appId)).toBe('premium');
  });
});
