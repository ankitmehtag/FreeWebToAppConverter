# F22 Multi-currency

Status: built, not deployed

## Goal
Let the owner set the Premium price per currency from the admin panel, and let a buyer pay in a currency that suits them, without a code change or a deploy.

## Out of scope
- Stripe (F14 T12 stays deferred); every currency goes through Razorpay.
- Automatic exchange rates: the owner types each price.
- Tax or GST changes.
- Per-plan price changes other than Premium (only Premium is sold).

## Screens
1. **Admin, new "Prices" page** (`/admin/prices`, behind the same 2FA): a table with one row per currency (code, symbol, price, on/off). Add a currency, change a price, switch a currency off. Each save asks for a reason and is written to the audit log.
2. **Pricing page**: the Premium card shows the price in the buyer's currency, with a small currency selector. Default is INR; the choice is remembered in the browser.
3. **Pay panel (wizard Review step)**: the same selector, the price, the coupon box as today; the button reads "Pay US$1" or "Pay ₹99" in the chosen currency.
4. **Receipts page and email**: show the currency the buyer paid in (already stored on the order).

## Requirements
- R1: Prices live in the database (`prices`: currency, amount in minor units, enabled), seeded from today's INR 9900 and USD 100; the hardcoded table in `server/src/payments/prices.ts` goes away.
- R2: `/payments/prices` returns only enabled currencies. If none are enabled, payments are off, as today.
- R3: Only admins can change prices, with 2FA, a reason and an audit entry; a price must be a whole positive number of minor units, and the currency must be a supported ISO code.
- R4: The price is read on the server at order creation and stored on the order; a later price change never alters an open or paid order, and the webhook's amount check (F14 R10) keeps comparing against the order.
- R5: Currencies with zero or three decimals (JPY, KWD) are formatted correctly; the first release supports INR, USD, EUR, GBP, AED, SGD.
- R6: A coupon (percent or flat) works in every currency; a flat coupon is valid only in its own currency.
- R7: Refunds go back in the order's own currency.
- R8: The Razorpay order is created with the chosen currency; if Razorpay rejects the currency (international payments not enabled on the account), the buyer sees a plain message and no order stays open.

## Acceptance criteria
- AC1 (R1, R2): Given a fresh database, when the server starts, then INR and USD prices exist and `/payments/prices` lists them.
- AC2 (R3): Given a non-admin or a session without 2FA, when it calls the prices admin API, then it gets 404 or is refused.
- AC3 (R3): Given an admin changes USD to 150, when the Pricing page reloads, then it shows US$1.50, and one audit entry exists.
- AC4 (R4): Given an open order at 100 cents, when the admin changes the price, then that order still charges 100 cents and its `paid` event still unlocks the app.
- AC5 (R2): Given a currency switched off, when a buyer opens the Pay panel, then it is not offered and a direct checkout call for it is refused.
- AC6 (R5): Given each supported currency, when a price is displayed, then it has the right symbol and decimals.
- AC7 (R6): Given a flat INR coupon, when a buyer chooses USD, then the coupon is refused with a clear message.
- AC8 (R7): Given a paid USD order, when it is refunded, then the refund is in USD.
- AC9 (R8): Given Razorpay rejects a currency, when a buyer tries it, then they see a short message and no `created` order is left behind.

## Open questions
- Q1: Decided by the owner on 2026-11-16: INR and USD. The code supports six; the admin can switch the others on later.
- Q2: Razorpay needs "International payments" enabled on your account before any non-INR order works, and its fees are higher on those (about 3 percent plus conversion). Is it enabled? If not, USD stays off until it is.
- Q3: US$1 loses a lot to fees (see F14 Q1). Do you want to raise the USD price (for example US$2 or 3) when this ships?
