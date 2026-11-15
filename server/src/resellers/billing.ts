import { ObjectId, type Document } from 'mongodb';
import type { Outcome } from '../payments/events';
import type { Payments } from '../payments/routes';
import type { ProviderName, WebhookEvent } from '../payments/provider';
import type { Resellers } from './index';

const OPEN = ['created', 'pending'];
/** A payment the provider confirms is paid whatever we thought of the order before: a failed attempt can be retried on the same order, and a closed one may still be paid. */
const PAYABLE = [...OPEN, 'failed', 'superseded'];

/**
 * The one way a plan order becomes paid and the reseller gets their month. Safe to run twice and from any path (modal, webhook, sweep):
 * the order is claimed once, and the month is applied once per order through `appliedOrders`. Returns whether the order is paid afterwards.
 */
export const activate = async (resellers: Resellers, order: Document, paymentId?: string, now = new Date()) => {
  await resellers.orders.updateOne({ _id: order._id, status: { $in: PAYABLE } }, { $set: { status: 'paid', paidAt: now, ...(paymentId ? { paymentId } : {}) } });
  const current = await resellers.orders.findOne({ _id: order._id });
  if (current?.status !== 'paid') return false;
  const before = await resellers.resellers.findOne({ _id: order.resellerId });
  if (!before) return true;
  const plan = await resellers.plans.findOne({ _id: before.planId });
  // One pipeline update: the month is added to whichever is later, now or the end of the month already paid, so paying early loses nothing.
  const applied = await resellers.resellers.updateOne({ _id: before._id, appliedOrders: { $ne: order._id } }, [
    {
      $set: {
        paidUntil: { $dateAdd: { startDate: { $max: ['$$NOW', { $ifNull: ['$paidUntil', '$$NOW'] }] }, unit: 'month', amount: 1 } },
        'quota.used': 0,
        'quota.periodStart': '$$NOW',
        'terms.buildsPerMonth': plan ? plan.buildsPerMonth : '$terms.buildsPerMonth',
        subscribedAt: { $ifNull: ['$subscribedAt', '$$NOW'] },
        appliedOrders: { $concatArrays: [{ $ifNull: ['$appliedOrders', []] }, [order._id]] },
      },
    },
    { $unset: 'lapsedAt' },
  ]);
  if (applied.modifiedCount === 1) {
    await resellers.orders.updateOne({ _id: order._id }, { $set: { appliedAt: now } });
    // Only the first payment says "started"; later months are quiet.
    if (!before.subscribedAt) {
      const after = await resellers.resellers.findOne({ _id: before._id });
      if (after) await resellers.notify?.('subscription_started', after, `started:${String(before._id)}:${String(order._id)}`).catch(() => undefined);
    }
  } else if (!current.appliedAt) {
    await resellers.orders.updateOne({ _id: order._id }, { $set: { appliedAt: now } });
  }
  return true;
};

/**
 * A provider event for a plan order, or null when the event is not about one (so F14's own handling goes on).
 * Refunds and disputes are recorded only: access ends when the admin cancels the plan, not by itself.
 */
export const resellerEvent = async (resellers: Resellers, provider: ProviderName, event: WebhookEvent): Promise<Outcome | null> => {
  const { orders } = resellers;
  if (event.type === 'refunded' || event.type === 'disputed') {
    const order = event.paymentId ? await orders.findOne({ provider, paymentId: event.paymentId }) : null;
    if (!order) return null;
    await orders.updateOne({ _id: order._id }, { $set: { status: event.type === 'refunded' ? 'refunded' : 'disputed', closedAt: new Date() } });
    console.error(`Reseller plan payment ${event.type}`, { orderId: String(order._id), resellerId: String(order.resellerId) });
    return 'applied';
  }
  const order = event.providerOrderId ? await orders.findOne({ provider, providerOrderId: event.providerOrderId }) : null;
  if (!order) return null;
  if (event.type === 'failed') {
    await orders.updateOne({ _id: order._id, status: { $in: OPEN } }, { $set: { status: 'failed', failedAt: new Date() } });
    return 'applied';
  }
  if (event.type !== 'paid') return 'ignored';
  if (order.amount !== event.amount || order.currency !== event.currency) {
    console.error('Reseller payment mismatch', { orderId: String(order._id), expected: [order.amount, order.currency], got: [event.amount, event.currency] });
    return 'mismatch';
  }
  await activate(resellers, order, event.paymentId);
  return 'applied';
};

/** Plans whose paid month has ended lapse, and the reseller is told once. */
export const lapseExpired = async (resellers: Resellers, now = new Date()) => {
  let lapsed = 0;
  for (const reseller of await resellers.resellers.find({ paidUntil: { $lt: now }, lapsedAt: { $exists: false } }).toArray()) {
    const claim = await resellers.resellers.updateOne({ _id: reseller._id, paidUntil: reseller.paidUntil, lapsedAt: { $exists: false } }, { $set: { lapsedAt: now } });
    if (!claim.modifiedCount) continue;
    lapsed += 1;
    await resellers.notify?.('payment_failed', reseller, `lapsed:${String(reseller._id)}:${(reseller.paidUntil as Date).getTime()}`).catch(() => undefined);
  }
  return lapsed;
};

/** The admin ends a plan now. Access to existing apps and downloads stays; new builds stop until it is paid for again or reinstated. */
export const cancelPlan = async (resellers: Resellers, resellerId: ObjectId, now = new Date()) => {
  const reseller = await resellers.resellers.findOneAndUpdate({ _id: resellerId }, { $set: { lapsedAt: now }, $unset: { paidUntil: '' } });
  if (!reseller) return false;
  await resellers.notify?.('subscription_cancelled', reseller, `cancelled:${String(resellerId)}:${now.getTime()}`).catch(() => undefined);
  return true;
};

export const reinstatePlan = async (resellers: Resellers, resellerId: ObjectId) => (await resellers.resellers.updateOne({ _id: resellerId }, { $unset: { lapsedAt: '' } })).matchedCount === 1;

type Started = { id: string; amount: number; currency: 'INR'; status: string; checkout: { provider: string; keyId: string | null; orderId: string; amount: number; currency: string; checkoutUrl: string | null } };
export type CheckoutResult = { ok: true; order: Started } | { ok: false; status: number; error: string };

const started = (order: Document): Started => ({
  id: String(order._id),
  amount: order.amount,
  currency: 'INR',
  status: order.status,
  checkout: { provider: order.provider, keyId: order.keyId ?? null, orderId: order.providerOrderId, amount: order.amount, currency: order.currency, checkoutUrl: order.checkoutUrl ?? null },
});

/** Starts, or picks up again, the payment for the next month. The price is the one this reseller joined at. */
export const startPlanCheckout = async (resellers: Resellers, payments: Payments, reseller: Document, email: string, appUrl: string): Promise<CheckoutResult> => {
  const amount = reseller.terms.priceMinor as number;
  const provider = payments.providers.razorpay;
  if (!provider) return { ok: false, status: 400, error: 'Payments are not available yet' };
  // Providers refuse tiny charges, so a free plan has nothing to pay.
  if (amount < 100) return { ok: false, status: 400, error: 'This plan has nothing to pay' };
  const open = await resellers.orders.findOne({ resellerId: reseller._id, status: { $in: OPEN } });
  if (open) {
    if (open.amount === amount) {
      // Still being set up, or cut off before the provider answered: the sweep closes it if it never finishes.
      return open.providerOrderId ? { ok: true, order: started(open) } : { ok: false, status: 409, error: 'Checkout is starting, try again in a moment' };
    }
    // An order at an old price is set aside so a new one can start. If it is paid after all, it still counts.
    await resellers.orders.updateOne({ _id: open._id, status: { $in: OPEN } }, { $set: { status: 'superseded', closedAt: new Date() } });
  }
  const plan = await resellers.plans.findOne({ _id: reseller.planId });
  const order = { _id: new ObjectId(), resellerId: reseller._id, userId: reseller.userId, planId: reseller.planId, provider: 'razorpay', currency: 'INR', amount, status: 'created', createdAt: new Date() };
  try {
    await resellers.orders.insertOne(order);
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return { ok: false, status: 409, error: 'Checkout is starting, try again in a moment' };
  }
  try {
    const checkout = await provider.createCheckout({ orderId: String(order._id), amount, currency: 'INR', description: `${String(plan?.name ?? 'Reseller')} plan, one month`, customerEmail: email, returnUrl: `${appUrl}/r/${String(reseller.slug)}` });
    const kept = { providerOrderId: checkout.providerOrderId, ...(checkout.keyId ? { keyId: checkout.keyId } : {}), ...(checkout.checkoutUrl ? { checkoutUrl: checkout.checkoutUrl } : {}) };
    await resellers.orders.updateOne({ _id: order._id }, { $set: kept });
    return { ok: true, order: started({ ...order, ...kept }) };
  } catch (error) {
    await resellers.orders.updateOne({ _id: order._id }, { $set: { status: 'failed', failedAt: new Date() } });
    console.error('Reseller checkout failed', error instanceof Error ? error.message : 'unknown');
    return { ok: false, status: 502, error: 'The payment provider is not answering, try again soon' };
  }
};

/** What the sweep does for plan orders: settle stuck ones from the provider's own word, and finish any paid order the process dropped halfway. */
export const reconcileResellerOrders = async (resellers: Resellers, payments: Payments, apply: (provider: ProviderName, event: WebhookEvent) => Promise<unknown>, now = new Date()) => {
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000);
  let settled = 0;
  for await (const order of resellers.orders.find({ status: { $in: OPEN }, createdAt: { $lte: cutoff } })) {
    try {
      if (typeof order.providerOrderId !== 'string') {
        await resellers.orders.updateOne({ _id: order._id, status: order.status }, { $set: { status: 'failed', failedAt: now } });
        continue;
      }
      const provider = payments.providers[order.provider as ProviderName];
      if (!provider) continue;
      const real = await provider.fetchStatus(order.providerOrderId);
      if (real.status === 'paid') {
        await apply(provider.name, { eventId: `reconcile:${String(order._id)}`, type: 'paid', providerOrderId: order.providerOrderId, paymentId: real.paymentId, amount: real.amount, currency: real.currency });
        settled += 1;
      } else if (real.status === 'expired' || real.status === 'failed') {
        await resellers.orders.updateOne({ _id: order._id, status: order.status }, { $set: { status: 'failed', failedAt: now } });
      }
    } catch (error) {
      console.error('Reconcile failed for one plan order', error instanceof Error ? error.message : 'unknown');
    }
  }
  for await (const order of resellers.orders.find({ status: 'paid', appliedAt: { $exists: false } })) {
    await activate(resellers, order, undefined, now).catch((error) => console.error('Plan repair failed', error instanceof Error ? error.message : 'unknown'));
    settled += 1;
  }
  return settled;
};
