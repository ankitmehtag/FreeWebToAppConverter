import type { Document, ObjectId } from 'mongodb';
import type { Resellers } from './index';

export type Claim =
  | { kind: 'none' }
  | { kind: 'ok'; resellerId: ObjectId; used: number; limit: number; periodStart: Date }
  | { kind: 'refused'; status: number; reason: string; message: string };

/**
 * Takes one build from the quota of the reseller who owns this user, in a single update so two builds started together can't both take the last one.
 * A user who is not a reseller is unaffected. Give the build back with `returnBuild` if it is refused before it queues.
 */
export const claimBuild = async ({ resellers }: Resellers, userId: ObjectId): Promise<Claim> => {
  const taken = await resellers.findOneAndUpdate(
    { userId, suspendedAt: { $exists: false }, lapsedAt: { $exists: false }, $expr: { $lt: ['$quota.used', { $add: ['$terms.buildsPerMonth', '$quota.bonus'] }] } },
    { $inc: { 'quota.used': 1 } },
  );
  if (taken) return { kind: 'ok', resellerId: taken._id, used: (taken.quota.used as number) + 1, limit: (taken.terms.buildsPerMonth as number) + (taken.quota.bonus as number), periodStart: taken.quota.periodStart as Date };
  const reseller = await resellers.findOne({ userId });
  if (!reseller) return { kind: 'none' };
  if (reseller.suspendedAt) return { kind: 'refused', status: 403, reason: 'reseller_suspended', message: 'This reseller account is suspended' };
  if (reseller.lapsedAt) return { kind: 'refused', status: 402, reason: 'plan_lapsed', message: 'The plan has lapsed. Renew it to start new builds.' };
  return { kind: 'refused', status: 429, reason: 'quota_exhausted', message: 'This month’s build quota is used up' };
};

export const returnBuild = async ({ resellers }: Resellers, resellerId: ObjectId) => {
  await resellers.updateOne({ _id: resellerId, 'quota.used': { $gt: 0 } }, { $inc: { 'quota.used': -1 } });
};

export const quotaOf = (reseller: Document) => {
  const limit = (reseller.terms.buildsPerMonth as number) + (reseller.quota.bonus as number);
  const used = reseller.quota.used as number;
  return { limit, used, remaining: Math.max(0, limit - used) };
};

/** A paid renewal: the month's quota starts again and picks up the plan's current build count. Unused builds do not carry over. */
export const renewQuota = async ({ resellers, plans }: Resellers, resellerId: ObjectId) => {
  const reseller = await resellers.findOne({ _id: resellerId });
  const plan = reseller && (await plans.findOne({ _id: reseller.planId }));
  if (!reseller || !plan) return false;
  await resellers.updateOne({ _id: resellerId }, { $set: { 'quota.used': 0, 'quota.periodStart': new Date(), 'terms.buildsPerMonth': plan.buildsPerMonth }, $unset: { lapsedAt: '' } });
  return true;
};

/** Tells the reseller once per month when four-fifths of the builds are used. Never waits for the email, and never fails the build. */
export const warnQuota = (resellers: Resellers, claim: Extract<Claim, { kind: 'ok' }>) => {
  if (claim.limit === 0 || claim.used * 5 < claim.limit * 4) return;
  void resellers.resellers
    .findOne({ _id: claim.resellerId })
    .then((reseller) => reseller && resellers.notify?.('quota_nearly_used', reseller, `quota80:${String(claim.resellerId)}:${claim.periodStart.getTime()}`, { used: claim.used, limit: claim.limit }))
    .catch(() => undefined);
};
