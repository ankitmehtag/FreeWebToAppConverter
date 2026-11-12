# F14 Verification

Status: waiting for the Razorpay test-mode run and the owner's sign-off.

Deployed to production on 2026-11-12 (commit 13e3732) with payments switched off: no `RAZORPAY_KEY_ID` is set on the server, so `/payments/prices` answers 404 and nothing is for sale. Stripe (T12) is deferred; the product is INR-only for now.

## Automated evidence

Server 392 tests, worker 126, shared 84, client 76. All pass. The payment tests run against a fake provider, so they prove our logic, not Razorpay's.

| Criterion | Where proven | Result |
|---|---|---|
| AC1 (order, pay, status from server) | `payments-checkout`, `payments-verify`, `razorpay` tests | pass with a fake provider; real test-mode run pending |
| AC2 (no second charge) | `payments-orders`, `payments-checkout` (index, reuse, three at once) | pass |
| AC3 (only the owner can buy) | `payments-checkout` | pass |
| AC4 (bad signature changes nothing) | `payments-webhook`, `payments-verify` | pass |
| AC5 (repeated event is a no-op) | `payments-webhook`, `payments-receipts` | pass |
| AC6 (amount and currency must match) | `payments-webhook` | pass |
| AC7 (cut-off event ends consistent) | `payments-webhook`, `payments-reconcile` | pass; done by retry, not a Mongo transaction, as the server is a single node |
| AC8 (refund before payment) | `payments-webhook` | pass |
| AC9 (stuck order fixed by sweep) | `payments-reconcile` | pass |
| AC10 (refund returns app to Free) | `payments-refund` | pass |
| AC11, AC12 (coupons) | `payments-coupons` | pass |
| AC13 (receipt, sequential, by email, in the account) | `payments-receipts` | pass; a real Resend email still to be seen |
| AC14 (no keys or card numbers) | `secret-scan` over tracked files, client bundle and test logs | pass; image layers below |
| AC15 (watermark follows the plan flag) | `worker/test/premium.test.ts` | pass |

## Found while building

- Razorpay Payment Links were refused for the owner's account ("api key expired"), so checkout uses Standard Checkout (Orders API and the modal), checked on the server with HMAC-SHA256 of `order_id|payment_id`.
- The first keys the owner pasted were Razorpay Live keys. No payment was made; two empty orders were created in the live account and will lapse. Test keys must be used until the owner decides to sell.

## Still to do

1. Test-mode keys in the local `.env`, then one real test order with Razorpay's test card, through the modal, ending paid with a receipt.
2. The same on production, after the owner fills `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in `.env.production`, and adds the webhook `https://freewebsitetoappconverter.com/payments/webhooks/razorpay` for `order.paid`, `refund.processed` and `payment.dispute.lost`.
3. A real refund through `npm run refund-order -w server -- <order id>`.
4. Image-layer scan result (below).
5. The owner's review of the Pricing, Terms and receipt wording.

Image layers: pending.

Sign-off: owner, date
