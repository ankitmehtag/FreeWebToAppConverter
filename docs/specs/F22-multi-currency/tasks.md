# F22 tasks

- [x] T1 Prices in the database: `prices` collection, seeded INR 9900 on and USD 100 off (R1, R2). USD starts off because Razorpay international payments are not confirmed (Q2); the owner switches it on in the admin panel.
- [x] T2 Checkout and coupon read the price from the database and store it on the order (R4, R6); Razorpay takes every currency (R8).
- [x] T3 Admin `GET/POST /admin/api/prices` with 2FA, reason and audit entry (R3).
- [x] T4 Admin "Prices" tab; currency picker on the Pricing page and the Pay panel; Intl price formatting (R5).
- [x] T5 Tests: prices seed and edit, admin route, open order keeps its price, off currency refused, Razorpay sends the chosen currency (AC1 to AC5, AC7). AC8 (refund in the order's currency) holds because refunds use the order's amount and payment id; no new test.
- [ ] T6 Deploy (only when the owner says), then check `/payments/prices` and the admin Prices tab.
- [ ] T7 Owner: confirm Razorpay international payments, switch USD on, make one small USD test, sign off. Q3 (the USD price) still open.
