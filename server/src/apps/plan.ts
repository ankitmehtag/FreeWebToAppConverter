import type { Collection, Document, ObjectId } from 'mongodb';

export type Plan = 'free' | 'premium';

const PLANS: readonly string[] = ['free', 'premium'];

/** Anything that isn't exactly "premium" is Free, so a missing or odd value never unlocks Premium. */
export const planOf = (app: { plan?: unknown }): Plan => (app.plan === 'premium' ? 'premium' : 'free');

/** The only code that writes an app's plan. F14 calls it after a payment, and `scripts/set-plan.ts` calls it for the owner. */
export const setPlan = async (apps: Collection<Document>, appId: ObjectId, plan: Plan): Promise<boolean> => {
  if (!PLANS.includes(plan)) throw new Error(`Not a plan: ${String(plan)}`);
  const { matchedCount } = await apps.updateOne({ _id: appId }, { $set: { plan } });
  return matchedCount === 1;
};
