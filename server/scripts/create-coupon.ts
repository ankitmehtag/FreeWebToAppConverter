// Creates a Premium coupon until the admin panel (F17) exists.
// Usage: create-coupon.ts <CODE> percent <1-100> [--max 100] [--per-user 1] [--days 30]
//        create-coupon.ts <CODE> flat INR:5000,USD:50 [--max 100] [--per-user 1] [--days 30]   (minor units: paise, cents)
import { MongoClient } from 'mongodb';
import { normalizeCode } from '../src/payments/coupons';
import { prepareOrders } from '../src/payments/orders';

const [rawCode, kind, value, ...rest] = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(rest[at + 1]);
};
const code = normalizeCode(rawCode);
const maxUses = option('max', 100);
const perUserLimit = option('per-user', 1);
const days = option('days', 30);
const usage = () => {
  console.error('Usage: create-coupon.ts <CODE> percent <1-100> | flat INR:5000,USD:50 [--max N] [--per-user N] [--days N]');
  process.exit(1);
};

if (!/^[A-Z0-9_-]{3,32}$/.test(code) || ![maxUses, perUserLimit, days].every((n) => Number.isInteger(n) && n > 0)) usage();
const doc: Record<string, unknown> = { code, plan: 'premium', maxUses, perUserLimit, used: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000) };
if (kind === 'percent' && /^\d+$/.test(value ?? '') && Number(value) >= 1 && Number(value) <= 100) {
  Object.assign(doc, { kind: 'percent', percent: Number(value) });
} else if (kind === 'flat' && /^((INR|USD):\d+)(,(INR|USD):\d+)*$/.test(value ?? '')) {
  Object.assign(doc, { kind: 'flat', flat: Object.fromEntries(value!.split(',').map((pair) => [pair.split(':')[0], Number(pair.split(':')[1])])) });
} else usage();

const mongo = await new MongoClient(process.env.MONGO_URL!).connect();
try {
  const { coupons } = await prepareOrders(mongo.db());
  await coupons.insertOne(doc);
  console.log(`Coupon ${code} created: ${kind} ${value}, ${maxUses} uses, ${perUserLimit} per user, expires in ${days} days.`);
} catch (error) {
  console.error((error as { code?: number }).code === 11000 ? `Coupon ${code} already exists` : `Failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await mongo.close();
}
