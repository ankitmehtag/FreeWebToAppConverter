import type { Document } from 'mongodb';
import { receipt } from '@sitetoapk/shared/mail';
import type { Payments } from './routes';

export const formatReceiptNo = (n: number) => `R-${String(n).padStart(6, '0')}`;

const STALE_MS = 10 * 60 * 1000;
const stale = () => ({ $lt: new Date(Date.now() - STALE_MS) });

/** What the buyer sees. Plain receipt: no tax line while the seller has no GST registration (Q2). */
export const receiptView = (order: Document) => ({
  id: String(order._id),
  receiptNo: order.receiptNo,
  issuedAt: order.paidAt,
  buyerEmail: order.receipt?.buyerEmail,
  appName: order.receipt?.appName,
  amount: order.amount,
  currency: order.currency,
  listAmount: order.listAmount ?? order.amount,
  couponCode: order.couponCode ?? null,
  status: order.status,
  tax: null,
});

/**
 * Gives a paid order its sequential number and emails the receipt. Each step is claimed before it runs and recorded after,
 * so a repeat does nothing and a cut-off run is finished by the next call. Never throws: a payment must not fail over a receipt.
 */
export const finishReceipt = async (payments: Payments, orderId: Document['_id']) => {
  const { orders, counters, apps, users, mailer } = payments;
  try {
    let order = await orders.findOne({ _id: orderId });
    if (!order || order.status !== 'paid' || order.amount === 0) return;

    if (order.receiptNo === undefined) {
      const claimed = await orders.updateOne(
        { _id: orderId, receiptNo: { $exists: false }, $or: [{ receiptClaimedAt: { $exists: false } }, { receiptClaimedAt: stale() }] },
        { $set: { receiptClaimedAt: new Date() } },
      );
      if (claimed.modifiedCount !== 1) return;
      const [user, app] = await Promise.all([users.findOne({ _id: order.userId }), apps.findOne({ _id: order.appId })]);
      const seq = await counters.findOneAndUpdate({ _id: 'receipt' as never }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
      await orders.updateOne(
        { _id: orderId },
        { $set: { receiptNo: formatReceiptNo(Number(seq?.seq)), receipt: { buyerEmail: String(user?.email ?? ''), appName: String(app?.draft?.appName ?? 'your app') } } },
      );
      order = await orders.findOne({ _id: orderId });
    }
    if (!order?.receiptNo || order.receiptEmailedAt || !mailer || !order.receipt?.buyerEmail) return;

    const claimed = await orders.findOneAndUpdate(
      { _id: orderId, receiptEmailedAt: { $exists: false }, $or: [{ receiptEmailClaimedAt: { $exists: false } }, { receiptEmailClaimedAt: stale() }] },
      { $set: { receiptEmailClaimedAt: new Date() } },
    );
    if (!claimed) return;
    try {
      await mailer.send({
        to: order.receipt.buyerEmail,
        ...receipt({ appUrl: payments.appUrl ?? '', receiptNo: order.receiptNo, paidAt: order.paidAt, buyerEmail: order.receipt.buyerEmail, appName: order.receipt.appName, couponCode: order.couponCode, listAmount: order.listAmount ?? order.amount, amount: order.amount, currency: order.currency }),
      });
      await orders.updateOne({ _id: orderId }, { $set: { receiptEmailedAt: new Date() } });
    } catch (error) {
      // Let the next sweep try again.
      await orders.updateOne({ _id: orderId }, { $unset: { receiptEmailClaimedAt: '' } });
      console.error('Receipt email failed', error instanceof Error ? error.message : 'unknown');
    }
  } catch (error) {
    console.error('Receipt failed', error instanceof Error ? error.message : 'unknown');
  }
};
