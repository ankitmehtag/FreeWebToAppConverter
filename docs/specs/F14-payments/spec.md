# F14 Payments

Status: draft

## Goal
Let a signed-in user buy Premium for one app, pay in INR through Razorpay or in other currencies through Stripe, and have that app unlocked the moment the payment is confirmed. The money side must be safe to get wrong in only one direction: a lost or repeated webhook never charges twice, never unlocks without payment, and never leaves a paid user locked. Refunds, coupons and receipts are part of this feature.

## Out of scope
- What Premium does once unlocked: own keystore, AAB, white label (F13). F14 only records and checks the entitlement; until F13 ships, Premium stays "coming soon" on the Pricing page.
- Prices in more than INR and one other currency, with admin-set per-currency prices (F22).
- An admin panel for orders and coupons (F17). Until then, coupons and manual refunds are done by a script run by the owner.
- Subscriptions, reseller plans and API keys (F20). Premium here is a one-time purchase per app.
- Manual add-ons such as Play publishing help (F21).
- Dunning, trials and upgrade or downgrade between paid plans.

## Requirements

### Plans and prices
- R1: There must be two plans, Free and Premium. Premium is bought per app, once, and belongs to that app for as long as the app exists. Free stays exactly as it is today.
- R2: Free costs 0. Premium costs 9900 paise (₹99) in INR and 100 cents (US$1) in USD, one time per app. Prices must be stored as integers in minor units (paise, cents) with a currency code, and read from one place in the server, never from the browser.
- R3: The Pricing page and the wizard must show the live price, and show Premium as available only when F13 and F14 are both live.

### Checkout
- R4: From an app's Review step, a user must be able to buy Premium for that app. The server must create an order with a unique id, the app, the user, the plan, the currency, the amount and the status `created`, then send the user to Razorpay (INR) or Stripe (other currencies) to pay.
- R5: A user must only be able to buy for an app they own, and only once per app. A second attempt while an order is `created` or `paid` must reuse or refuse, never create a duplicate charge.
- R6: The provider is chosen from the user's country at checkout. The user can switch before paying.
- R7: Returning from the provider's page must show the real order status from the server, not trust the redirect.

### Webhooks and entitlement
- R8: Each provider's webhook must verify its signature on the raw body before reading anything, and reject unsigned or wrongly signed requests with no side effects.
- R9: Every provider event id must be stored with a unique index. A repeated or replayed event must be a no-op and still answer 200.
- R10: An app is Premium only after a verified `paid` event for its order, and the amount and currency in the event must match the order. A mismatch must not unlock the app and must be logged for the owner.
- R11: The unlock must be atomic with the order's move to `paid`: no state where one is set and the other is not, even if the process stops between steps.
- R12: Events must be handled in any order. A `refunded` event arriving before `paid` must not leave the app unlocked.
- R13: A cron must reconcile orders stuck in `created` or `pending` for over 30 minutes by asking the provider for the real status.

### Refunds and disputes
- R14: A full refund, a failed payment and a lost dispute must each return the app to Free for new builds. Builds already made stay downloadable until their normal expiry. F13's keystore download is revoked on refund.
- R15: The owner must be able to issue a full refund from a script (admin panel comes with F17). The refund must go through the provider and be recorded on the order.
- R16: The refund window must be stated on the Pricing page and in the Terms.

### Coupons
- R17: A coupon must have a code, a percent or flat amount, an expiry, a total use limit, a per-user limit and a plan restriction.
- R18: Redemption must be atomic, so two buyers using the last use of a coupon cannot both succeed.
- R19: A 100 percent coupon must still create an order and an entitlement through the same path, without calling a provider, so it appears in records.

### Receipts, tax and records
- R20: Each paid order must produce a receipt with a sequential number, the buyer's email, the app, the amount, the currency, the tax shown separately if any, and the date, emailed through Resend and viewable in the account.
- R21: Orders, events and refunds must be kept, and must not be deleted when an account is deleted. They must lose only the personal fields allowed by the law that requires keeping them.

### Safety and abuse
- R22: Card data must never touch our servers or logs. Only the provider's hosted checkout is used.
- R23: Provider keys and webhook secrets must live only in the server's `.env.production`, never in the repo, the image, the client or logs. Test mode keys must be used outside production.
- R24: Order creation must be rate limited per user, and the build limit and watermark rules must stay enforced by the worker from the app's plan flag.

## Acceptance criteria
- AC1 (R4, R7): Given a signed-in owner of an app, when they start checkout and pay with a provider's test card, then the order becomes `paid`, the app shows Premium, and the return page reads the status from the server.
- AC2 (R5): Given an app with an open or paid order, when the same user starts checkout again, then no second charge is possible.
- AC3 (R5): Given another user's app id, when a user tries to buy it, then the request is refused and no order exists.
- AC4 (R8): Given a webhook with a missing or wrong signature, when it arrives, then it is rejected with 4xx and nothing changes.
- AC5 (R9): Given a valid `paid` event sent twice, when both arrive, then the order is paid once, one receipt is sent and both answer 200.
- AC6 (R10): Given a `paid` event whose amount or currency differs from the order, when it arrives, then the app stays Free and the mismatch is logged.
- AC7 (R11): Given the process killed between recording the event and unlocking, when it restarts and the event is retried, then the order and the app end up consistent.
- AC8 (R12): Given `refunded` delivered before `paid`, when both are processed, then the app ends Free.
- AC9 (R13): Given an order left `created` after the user paid, when the reconciliation cron runs, then the order and the app are fixed from the provider's real status.
- AC10 (R14, R15): Given a paid app, when the owner refunds it, then the order shows `refunded`, new builds use Free rules, and earlier build links keep working until they expire.
- AC11 (R17, R18): Given a coupon with one use left, when two buyers redeem it at the same moment, then exactly one succeeds.
- AC12 (R19): Given a 100 percent coupon, when a user redeems it, then the app is unlocked with a recorded order and no provider call.
- AC13 (R20): Given a paid order, when it completes, then the buyer gets an email receipt with a sequential number and it is viewable in their account.
- AC14 (R22, R23): Given the repo, the client bundle, the logs and the image layers, when searched for provider keys, secrets and card numbers, then none are found.
- AC15 (R24): Given a paid app, when it builds, then the worker removes the watermark based on the app's plan flag, and a Free app's config cannot remove it.

## Open questions
- Q1: Decided by the owner on 2026-11-12: Free is 0, Premium is ₹99 or US$1 per app. Note: Stripe's fixed fee per card charge (about US$0.30 plus a percentage) would take roughly a third of a US$1 sale. Revisit the USD price, or Stripe at all, when F14 is built.
- Q2: Is the seller registered for GST in India? This decides whether receipts must be GST invoices with a GSTIN, or plain receipts. Proposed: plain receipts with the tax line empty until the owner confirms registration, then GST invoices.
- Q3: Does the owner's business have Razorpay approved, and can it take Stripe (India accounts can be restricted)? Proposed: build Razorpay first, add Stripe behind the same interface, and ship INR-only if Stripe is not available.
- Q4: Refund window? Proposed: 7 days for a full refund if no AAB or keystore has been downloaded.
- Q5: Cost: both providers charge per transaction only, with no monthly fee (typically about 2 to 3 percent plus tax, higher for international cards). No other cost is added by F14. Proposed: manual receipts, no paid tax service.
- Q6: Can Premium be bought before F13 is done, as a pre-order? Proposed: no. Ship F13 first or together, so no one pays for something not yet delivered.
