# F14 Tasks

## Design
- Collections: `orders` (id, userId, appId, plan, provider, currency, amount in minor units, status `created|pending|paid|failed|refunded|disputed`, couponCode, receiptNo, timestamps), `providerEvents` (unique `provider+eventId`, raw body hash, handledAt), `coupons`, and a `receiptCounter`.
- One `PaymentProvider` interface (`createCheckout`, `verifyWebhook`, `fetchStatus`, `refund`) with Razorpay first and Stripe added later behind it.
- An app's plan is a field on the app, written only by the one function that moves an order to `paid` or `refunded`, inside one Mongo transaction with the order and event writes.
- Prices live in one server module (₹99 = 9900 paise, US$1 = 100 cents). The browser asks the server for them.
- Webhook routes read the raw body before JSON parsing. Keys and secrets come from `.env.production` only, test keys elsewhere.
- F14 can be built and verified in provider test mode while F13 is in progress. Premium stays "coming soon" on the Pricing page until F13 and F14 are both signed off (R3, Q6).

## Slices
- [x] T1: Plan and price module, `orders` and `providerEvents` collections with indexes, app plan field (R1, R2)
  - Tests first: AC2, AC3
- [x] T2: `PaymentProvider` interface and the Razorpay provider: create checkout, fetch status (R4, R6)
  - Tests first: AC1
- [x] T3: Checkout API and the Review-step buy button, with ownership, one-order-per-app and rate limit (R4, R5, R7, R24)
  - Tests first: AC1, AC2, AC3
- [x] T4: Razorpay webhook: raw-body signature check, event idempotency, amount and currency match (R8, R9, R10)
  - Tests first: AC4, AC5, AC6
- [x] T5: Atomic unlock and out-of-order events (R11, R12)
  - Tests first: AC7, AC8
- [ ] T6: Reconciliation cron for stuck orders (R13)
  - Tests first: AC9
- [ ] T7: Refunds, failed payments and disputes, and the owner's refund script (R14, R15, R16)
  - Tests first: AC10
- [ ] T8: Coupons: model, atomic redemption, 100 percent path with no provider call (R17, R18, R19)
  - Tests first: AC11, AC12
- [ ] T9: Receipts with sequential numbers, emailed through Resend and shown in the account, plain receipts while there is no GST (R20, R21)
  - Tests first: AC13
- [ ] T10: Worker reads the app's plan flag for the watermark (R24)
  - Tests first: AC15
- [ ] T11: Secret and card-data scan of the repo, bundle, logs and image layers, and the refund window text in Terms and on Pricing (R16, R22, R23)
  - Tests first: AC14
- [ ] T12: Stripe provider behind the same interface, for USD, or INR-only if Stripe is not available to the seller (R6, Q3)
  - Tests first: AC1, AC4, AC5
