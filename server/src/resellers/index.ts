import type { Collection, Db, Document } from 'mongodb';
import { z } from 'zod';
import { createNotify, type Notify, type NoticeDeps } from './notices';

export type Resellers = { plans: Collection<Document>; resellers: Collection<Document>; keys: Collection<Document>; callbacks: Collection<Document>; /** Monthly plan payments. */ orders: Collection<Document>; /** Emails a reseller about their account. Absent where no mailer is set. */ notify?: Notify };

/** Starting plans, written once into an empty collection. The admin edits them from there; nothing else reads these numbers. */
const SEED_PLANS = [
  { name: 'Starter', priceMinor: 99900, buildsPerMonth: 10, api: false, builtWithLine: true },
  { name: 'Growth', priceMinor: 249900, buildsPerMonth: 30, api: true, builtWithLine: true },
  { name: 'Agency', priceMinor: 599900, buildsPerMonth: 100, api: true, builtWithLine: false },
];

export const prepareResellers = async (db: Db, mail?: Omit<NoticeDeps, 'notices' | 'plans'>): Promise<Resellers> => {
  const plans = db.collection('resellerPlans');
  const resellers = db.collection('resellers');
  const keys = db.collection('resellerKeys');
  const callbacks = db.collection('resellerCallbacks');
  await callbacks.createIndex({ buildId: 1 }, { unique: true });
  await callbacks.createIndex({ status: 1, nextAttemptAt: 1 });
  await keys.createIndex({ hash: 1 }, { unique: true });
  await keys.createIndex({ resellerId: 1 });
  await plans.createIndex({ name: 1 }, { unique: true });
  await resellers.createIndex({ slug: 1 }, { unique: true });
  await resellers.createIndex({ userId: 1 }, { unique: true });
  if ((await plans.estimatedDocumentCount()) === 0) {
    await plans.insertMany(SEED_PLANS.map((plan) => ({ ...plan, active: true, createdAt: new Date() }))).catch((error: { code?: number }) => {
      if (error.code !== 11000) throw error;
    });
  }
  const orders = db.collection('resellerOrders');
  await orders.createIndex({ provider: 1, providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: 'string' } } });
  // One open payment per reseller: a second one for the same month is impossible, not just unlikely.
  await orders.createIndex({ resellerId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['created', 'pending'] } } });
  await orders.createIndex({ status: 1, createdAt: 1 });
  const notices = db.collection('resellerNotices');
  return { plans, resellers, keys, callbacks, orders, notify: mail && createNotify({ ...mail, notices, plans }) };
};

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/);
const https = z.string().trim().max(500).url().refine((value) => value.startsWith('https://'), 'Must be https');
const accent = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/);
const id24 = z.string().regex(/^[0-9a-f]{24}$/);

export const planFields = {
  name: z.string().trim().min(2).max(40),
  priceMinor: z.number().int().min(0).max(100_000_000),
  buildsPerMonth: z.number().int().min(0).max(100_000),
  api: z.boolean(),
  builtWithLine: z.boolean(),
  active: z.boolean(),
};
export const planCreate = z.strictObject({ ...planFields, active: planFields.active.default(true), reason: z.string().trim().min(3).max(200) });
export const planEdit = z.strictObject({ ...Object.fromEntries(Object.entries(planFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof planFields]: z.ZodOptional<(typeof planFields)[K]> }, applyQuotaNow: z.boolean().optional(), reason: z.string().trim().min(3).max(200) });

export const resellerCreate = z.strictObject({
  userEmail: z.string().trim().toLowerCase().email(),
  slug,
  brandName: z.string().trim().min(2).max(40),
  logoUrl: https.optional(),
  accent: accent.default('#2563eb'),
  planId: id24,
  reason: z.string().trim().min(3).max(200),
});
export const resellerEdit = z.strictObject({
  slug: slug.optional(),
  brandName: z.string().trim().min(2).max(40).optional(),
  logoUrl: https.or(z.literal('')).optional(),
  accent: accent.optional(),
  planId: id24.optional(),
  callbackUrl: https.or(z.literal('')).optional(),
  addQuota: z.number().int().min(-100_000).max(100_000).optional(),
  resetQuota: z.boolean().optional(),
  reason: z.string().trim().min(3).max(200),
});

/** What a reseller is held to. Copied from the plan when they join it, so a later price edit does not reach them. */
export const termsOf = (plan: Document) => ({ priceMinor: plan.priceMinor as number, buildsPerMonth: plan.buildsPerMonth as number, api: plan.api as boolean, builtWithLine: plan.builtWithLine as boolean });

/** The only reseller fields a visitor may see. */
export const brandView = (reseller: Document) => ({ slug: reseller.slug as string, brandName: reseller.brandName as string, logoUrl: (reseller.logoUrl as string | undefined) || null, accent: reseller.accent as string, showBuiltWith: Boolean((reseller.terms as Document).builtWithLine) });

export const isDuplicate = (error: unknown) => (error as { code?: number }).code === 11000;

export const planView = (plan: Document) => ({ id: String(plan._id), name: plan.name as string, priceMinor: plan.priceMinor as number, buildsPerMonth: plan.buildsPerMonth as number, api: plan.api as boolean, builtWithLine: plan.builtWithLine as boolean, active: Boolean(plan.active) });

/** What the admin sees of a reseller. The callback secret and the stored hashes never leave the server. */
export const adminResellerView = (reseller: Document, userEmail: string | null, planName: string | null) => {
  const limit = (reseller.terms.buildsPerMonth as number) + (reseller.quota.bonus as number);
  return {
    id: String(reseller._id),
    slug: reseller.slug as string,
    brandName: reseller.brandName as string,
    logoUrl: (reseller.logoUrl as string | undefined) ?? '',
    accent: reseller.accent as string,
    callbackUrl: (reseller.callbackUrl as string | undefined) ?? '',
    userEmail,
    planId: String(reseller.planId),
    planName,
    terms: reseller.terms as Document,
    quota: { limit, used: reseller.quota.used as number, bonus: reseller.quota.bonus as number },
    paidUntil: (reseller.paidUntil as Date | undefined) ?? null,
    suspended: Boolean(reseller.suspendedAt),
    lapsed: Boolean(reseller.lapsedAt),
    createdAt: reseller.createdAt as Date,
  };
};
