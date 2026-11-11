import type { Collection, Document, ObjectId } from 'mongodb';
import type { Currency } from './prices';

export const normalizeCode = (code: unknown) => (typeof code === 'string' ? code.trim().toUpperCase() : '');

/** The price after a coupon, in minor units, or undefined when the coupon has no value in this currency. */
export const discounted = (coupon: Document, amount: number, currency: Currency): number | undefined => {
  if (coupon.kind === 'percent') return amount - Math.round((amount * Number(coupon.percent)) / 100);
  if (coupon.kind === 'flat') {
    const off = (coupon.flat as Partial<Record<Currency, number>> | undefined)?.[currency];
    return typeof off === 'number' ? Math.max(0, amount - off) : undefined;
  }
  return undefined;
};

/** A coupon that exists, fits the plan and is neither expired nor used up. A read only: redeeming is what takes a use. */
export const findUsable = async (coupons: Collection<Document>, code: string, plan: string, now = new Date()) => {
  const coupon = await coupons.findOne({ code });
  if (!coupon || coupon.plan !== plan || coupon.expiresAt <= now || coupon.used >= coupon.maxUses) return null;
  return coupon;
};

const userKey = (userId: ObjectId) => `usedBy.${userId.toHexString()}`;

/** Takes one use in a single update, so two buyers after the last use cannot both get it. */
export const redeem = async (coupons: Collection<Document>, coupon: Document, userId: ObjectId, now = new Date()) => {
  const key = userKey(userId);
  const taken = await coupons.updateOne(
    {
      _id: coupon._id,
      expiresAt: { $gt: now },
      $expr: { $lt: ['$used', '$maxUses'] },
      $or: [{ [key]: { $exists: false } }, { [key]: { $lt: coupon.perUserLimit } }],
    },
    { $inc: { used: 1, [key]: 1 } },
  );
  return taken.modifiedCount === 1;
};

/** Gives the use back when an order that took it ends unpaid. Once per order. */
export const releaseCoupon = async (payments: { orders: Collection<Document>; coupons: Collection<Document> }, order: Document) => {
  if (!order.couponId) return;
  const flagged = await payments.orders.updateOne(
    { _id: order._id, couponRedeemed: true, couponReleased: { $ne: true } },
    { $set: { couponReleased: true } },
  );
  if (flagged.modifiedCount !== 1) return;
  await payments.coupons.updateOne({ _id: order.couponId }, { $inc: { used: -1, [userKey(order.userId)]: -1 } });
};
