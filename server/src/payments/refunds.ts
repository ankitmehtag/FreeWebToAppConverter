import { ObjectId, type Document } from 'mongodb';
import { setPlan } from '../apps/plan';
import type { Payments } from './routes';

/** A full refund is offered this long after payment, and only while no bundle or key has been taken (Q4). */
export const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns an order's app to Free and takes back its key. Used by every way an order can end after payment:
 * a refund event, a lost dispute and the owner's refund. Safe to run twice.
 */
export const closeOrder = async (payments: Payments, order: Document, status: 'refunded' | 'disputed', extra: Document = {}) => {
  const { orders, apps, keystores } = payments;
  await orders.updateOne({ _id: order._id, status: 'paid' }, { $set: { status, [`${status === 'refunded' ? 'refundedAt' : 'disputedAt'}`]: new Date(), ...extra } });
  const current = await orders.findOne({ _id: order._id });
  if (current?.status !== status) return;
  await setPlan(apps, order.appId, 'free');
  await keystores?.updateOne({ appId: order.appId }, { $set: { revokedAt: new Date() } });
};

export type RefundResult = { ok: true; refundId: string } | { ok: false; reason: string };

/** The owner's refund: through the provider first, then recorded. `force` skips the window and download rules. */
export const refundOrder = async (payments: Payments, orderId: string, { force = false, now = new Date() } = {}): Promise<RefundResult> => {
  const { orders, providers, keystores, builds } = payments;
  const order = /^[0-9a-f]{24}$/.test(orderId) ? await orders.findOne({ _id: new ObjectId(orderId) }) : null;
  if (!order) return { ok: false, reason: 'No such order' };
  if (order.status !== 'paid') return { ok: false, reason: `The order is ${order.status}, not paid` };
  if (typeof order.paymentId !== 'string') return { ok: false, reason: 'The order has no payment id to refund' };

  if (!force) {
    const paidAt = order.paidAt instanceof Date ? order.paidAt : order.createdAt;
    if (now.getTime() - paidAt.getTime() > REFUND_WINDOW_MS) return { ok: false, reason: 'Past the 7-day refund window' };
    if ((await keystores?.findOne({ appId: order.appId, downloadedAt: { $ne: null } })) || (await builds?.findOne({ appId: order.appId, aabDownloadedAt: { $exists: true } }))) {
      return { ok: false, reason: 'The key or the bundle has been downloaded' };
    }
  }
  const provider = providers[order.provider as keyof typeof providers];
  if (!provider) return { ok: false, reason: `${order.provider} is not set up on this server` };

  let refundId: string;
  try {
    ({ refundId } = await provider.refund(order.paymentId, order.amount));
  } catch (error) {
    return { ok: false, reason: `The provider refused: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
  await closeOrder(payments, order, 'refunded', { refundId });
  return { ok: true, refundId };
};
