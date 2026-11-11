import { createHash } from 'node:crypto';
import { setPlan } from '../apps/plan';
import type { Payments } from './routes';
import type { ProviderName, WebhookEvent } from './provider';

export type Outcome = 'applied' | 'duplicate' | 'ignored' | 'mismatch' | 'unknown-order';

export const hashBody = (rawBody: Buffer) => createHash('sha256').update(rawBody).digest('hex');

/**
 * Applies one verified event. The event is recorded first under a unique id; a repeat that was fully handled does nothing,
 * and one that was cut off before it finished runs again. Every step is safe to run twice.
 */
export const applyEvent = async (payments: Payments, provider: ProviderName, event: WebhookEvent, bodyHash: string): Promise<Outcome> => {
  const { providerEvents, orders, apps } = payments;
  try {
    await providerEvents.insertOne({ provider, eventId: event.eventId, bodyHash, type: event.type, paymentId: event.paymentId, amount: event.amount, receivedAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const seen = await providerEvents.findOne({ provider, eventId: event.eventId });
    if (seen?.handledAt) return 'duplicate';
  }
  const done = async (outcome: Outcome) => {
    await providerEvents.updateOne({ provider, eventId: event.eventId }, { $set: { handledAt: new Date(), outcome } });
    return outcome;
  };

  if (event.type === 'refunded') {
    const refunded = event.paymentId ? await orders.findOne({ provider, paymentId: event.paymentId }) : null;
    // The payment may not be recorded yet. The event stays open, so the provider's retry finds the order.
    if (!refunded) return 'unknown-order';
    // Only full refunds take Premium away (Q4).
    if (event.amount !== refunded.amount) return done('ignored');
    await orders.updateOne({ _id: refunded._id, status: 'paid' }, { $set: { status: 'refunded', refundedAt: new Date() } });
    if ((await orders.findOne({ _id: refunded._id }))?.status === 'refunded') await setPlan(apps, refunded.appId, 'free');
    return done('applied');
  }
  if (event.type !== 'paid') return done('ignored');

  const order = event.providerOrderId ? await orders.findOne({ provider, providerOrderId: event.providerOrderId }) : null;
  // Not recorded yet, perhaps because the provider was quicker than we were. Left open, so its retry comes back here.
  if (!order) return 'unknown-order';

  if (order.amount !== event.amount || order.currency !== event.currency) {
    console.error('Payment mismatch', { orderId: String(order._id), expected: [order.amount, order.currency], got: [event.amount, event.currency] });
    return done('mismatch');
  }

  // A full refund that arrived first wins: the order closes as refunded and the app is never unlocked.
  const earlyRefund = event.paymentId
    ? await providerEvents.findOne({ provider, type: 'refunded', paymentId: event.paymentId, amount: order.amount })
    : null;
  if (earlyRefund) {
    await orders.updateOne(
      { _id: order._id, status: { $in: ['created', 'pending'] } },
      { $set: { status: 'refunded', paidAt: new Date(), refundedAt: new Date(), paymentId: event.paymentId } },
    );
    return done('applied');
  }

  await orders.updateOne(
    { _id: order._id, status: { $in: ['created', 'pending'] } },
    { $set: { status: 'paid', paidAt: new Date(), ...(event.paymentId ? { paymentId: event.paymentId } : {}) } },
  );
  const current = await orders.findOne({ _id: order._id });
  if (current?.status === 'paid') await setPlan(apps, order.appId, 'premium');
  return done('applied');
};
