import type { Db } from 'mongodb';

export type OrderStatus = 'created' | 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';

/** States in which an order still counts: a second one for the same app must not start. */
export const OPEN_STATUSES: readonly OrderStatus[] = ['created', 'pending', 'paid'];

/** Creates the payment collections and their indexes. */
export const prepareOrders = async (db: Db) => {
  const orders = db.collection('orders');
  const providerEvents = db.collection('providerEvents');
  const coupons = db.collection('coupons');
  const counters = db.collection('counters');

  // One live order per app: a second charge for the same app is impossible, not just unlikely (R5).
  await orders.createIndex({ appId: 1 }, { unique: true, partialFilterExpression: { status: { $in: [...OPEN_STATUSES] } } });
  await orders.createIndex({ provider: 1, providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: 'string' } } });
  await orders.createIndex({ userId: 1, createdAt: -1 });
  await orders.createIndex({ status: 1, createdAt: 1 });
  // A repeated or replayed event is a no-op (R9).
  await providerEvents.createIndex({ provider: 1, eventId: 1 }, { unique: true });
  await coupons.createIndex({ code: 1 }, { unique: true });

  return { orders, providerEvents, coupons, counters };
};
