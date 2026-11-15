import type { Collection, Document } from 'mongodb';
import { resellerCancelled, resellerPaymentFailed, resellerQuotaNearlyUsed, resellerStarted, type Message } from '@sitetoapk/shared/mail';
import type { Mailer } from '../auth/types';

export type NoticeKind = 'subscription_started' | 'payment_failed' | 'quota_nearly_used' | 'subscription_cancelled';
type Facts = { used?: number; limit?: number };
/** Sends one email about a reseller's account. `key` names the event, so the same event never sends twice. Resolves true when it sent. */
export type Notify = (kind: NoticeKind, reseller: Document, key: string, facts?: Facts) => Promise<boolean>;
export type NoticeDeps = { notices: Collection<Document>; plans: Collection<Document>; users: Collection<Document>; mailer: Mailer; appUrl: string };

const rupees = (minor: number) => `₹${minor / 100}`;

export const createNotify = ({ notices, plans, users, mailer, appUrl }: NoticeDeps): Notify => async (kind, reseller, key, facts = {}) => {
  // Claimed before sending, so two servers or a retried webhook can't both send it.
  try {
    await notices.insertOne({ _id: key as never, kind, resellerId: reseller._id, createdAt: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
  try {
    const user = await users.findOne({ _id: reseller.userId });
    if (!user?.email) throw new Error('no address');
    const plan = await plans.findOne({ _id: reseller.planId });
    const common = { appUrl, brandName: String(reseller.brandName), planName: String(plan?.name ?? 'reseller'), link: `${appUrl}/r/${String(reseller.slug)}` };
    const message: Message =
      kind === 'subscription_started' ? resellerStarted({ ...common, buildsPerMonth: reseller.terms.buildsPerMonth, price: rupees(reseller.terms.priceMinor) })
      : kind === 'payment_failed' ? resellerPaymentFailed(common)
      : kind === 'quota_nearly_used' ? resellerQuotaNearlyUsed({ ...common, used: facts.used ?? 0, limit: facts.limit ?? 0 })
      : resellerCancelled(common);
    await mailer.send({ to: String(user.email), ...message });
    return true;
  } catch (error) {
    // A failed send is released so the next event can try again, and is logged without the address or the link (F18 R9).
    await notices.deleteOne({ _id: key as never });
    console.error(`Reseller email ${kind} failed`, error instanceof Error ? error.message.replace(/\S+@\S+/g, '[address]') : 'unknown');
    return false;
  }
};
