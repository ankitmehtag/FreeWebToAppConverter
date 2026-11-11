import { setPlan } from '../apps/plan';
import { releaseCoupon } from './coupons';
import { applyEvent } from './events';
import { finishReceipt } from './receipts';
import { markPaid } from './unlock';
import type { Payments } from './routes';

/** An order is left alone this long, so the usual webhook gets there first. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;

/**
 * Fixes orders a webhook never settled, from what the provider says now, and re-unlocks any paid order whose app is still Free.
 * Safe to run any number of times: a payment goes through the same event path as a webhook, under one id per order.
 */
export const reconcile = async (payments: Payments, now = new Date()) => {
  const { orders, apps, providers } = payments;
  const result = { checked: 0, paid: 0, failed: 0, repaired: 0, errors: 0 };
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);

  for await (const order of orders.find({ status: { $in: ['created', 'pending'] }, createdAt: { $lte: cutoff } })) {
    result.checked += 1;
    try {
      if (order.provider === 'coupon' && order.couponRedeemed) {
        // A free order whose coupon was taken but whose unlock was cut off.
        if (await markPaid(payments, order)) result.paid += 1;
        continue;
      }
      if (typeof order.providerOrderId !== 'string') {
        // The provider call never finished, so there is nothing to pay.
        await orders.updateOne({ _id: order._id, status: order.status }, { $set: { status: 'failed', failedAt: now } });
        await releaseCoupon(payments, order);
        result.failed += 1;
        continue;
      }
      const provider = providers[order.provider as keyof typeof providers];
      if (!provider) continue;
      const real = await provider.fetchStatus(order.providerOrderId);
      if (real.status === 'paid') {
        const outcome = await applyEvent(
          payments,
          provider.name,
          { eventId: `reconcile:${order._id}`, type: 'paid', providerOrderId: order.providerOrderId, paymentId: real.paymentId, amount: real.amount, currency: real.currency },
          'reconcile',
        );
        if (outcome === 'applied') result.paid += 1;
      } else if (real.status === 'expired' || real.status === 'failed') {
        await orders.updateOne({ _id: order._id, status: order.status }, { $set: { status: 'failed', failedAt: now } });
        await releaseCoupon(payments, order);
        result.failed += 1;
      }
    } catch (error) {
      result.errors += 1;
      console.error('Reconcile failed for one order', error instanceof Error ? error.message : 'unknown');
    }
  }

  // A paid order always means a Premium app, even if the process stopped between the two writes.
  for await (const order of orders.find({ status: 'paid' })) {
    const app = await apps.findOne({ _id: order.appId }, { projection: { plan: 1 } });
    if (app && app.plan !== 'premium') {
      await setPlan(apps, order.appId, 'premium');
      result.repaired += 1;
    }
    // A receipt cut off before its number or its email.
    if (!order.receiptEmailedAt) await finishReceipt(payments, order._id);
  }
  return result;
};
