import type { Document } from 'mongodb';
import { setPlan } from '../apps/plan';
import { finishReceipt } from './receipts';
import type { Payments } from './routes';

/**
 * The one way an order becomes paid and its app Premium. Safe to run twice and from any path: a webhook, the sweep or a free coupon.
 * Returns whether the order is paid afterwards. A refunded or failed order stays as it is.
 */
export const markPaid = async (payments: Payments, order: Document, paymentId?: string) => {
  const { orders, apps } = payments;
  await orders.updateOne(
    { _id: order._id, status: { $in: ['created', 'pending'] } },
    { $set: { status: 'paid', paidAt: new Date(), ...(paymentId ? { paymentId } : {}) } },
  );
  const current = await orders.findOne({ _id: order._id });
  if (current?.status !== 'paid') return false;
  await setPlan(apps, order.appId, 'premium');
  await finishReceipt(payments, order._id);
  return true;
};
