import type { Plan } from '../apps/plan';

export type Currency = 'INR' | 'USD';

/** Minor units: paise and cents. The only place a price is written; the browser asks the server for it. */
const PREMIUM: Record<Currency, number> = { INR: 9900, USD: 100 };

export const isCurrency = (value: unknown): value is Currency => value === 'INR' || value === 'USD';

export const premiumPrice = (currency: Currency) => PREMIUM[currency];

/** The price of a plan, or undefined for a plan or currency this server does not sell. */
export const priceOf = (plan: Plan | string, currency: string): number | undefined => {
  if (!isCurrency(currency)) return undefined;
  if (plan === 'free') return 0;
  return plan === 'premium' ? PREMIUM[currency] : undefined;
};
