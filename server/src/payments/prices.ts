import type { Collection, Document } from 'mongodb';

/** ISO codes the shop can sell in. Which of them are on, and for how much, lives in the database. */
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (value: unknown): value is Currency => typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);

/** Minor units: paise and cents. First-run values only; after that the admin's Prices page is the source. USD starts off until Razorpay international payments are on. */
const SEED: { currency: Currency; amount: number; enabled: boolean }[] = [
  { currency: 'INR', amount: 9900, enabled: true },
  { currency: 'USD', amount: 100, enabled: false },
];

export const seedPrices = async (prices: Collection<Document>) => {
  await prices.createIndex({ currency: 1 }, { unique: true });
  for (const row of SEED) await prices.updateOne({ currency: row.currency }, { $setOnInsert: { ...row, updatedAt: new Date() } }, { upsert: true });
};

/** The price of Premium in a currency, or undefined when that currency is off or unknown. */
export const premiumPrice = async (prices: Collection<Document>, currency: Currency): Promise<number | undefined> => {
  const row = await prices.findOne({ currency, enabled: true });
  return typeof row?.amount === 'number' ? row.amount : undefined;
};

/** Every enabled currency with its Premium price. */
export const enabledPrices = async (prices: Collection<Document>) => {
  const rows = await prices.find({ enabled: true }, { sort: { currency: 1 } }).toArray();
  return Object.fromEntries(rows.filter((row) => isCurrency(row.currency) && typeof row.amount === 'number').map((row) => [row.currency, row.amount as number])) as Partial<Record<Currency, number>>;
};
