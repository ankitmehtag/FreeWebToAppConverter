# F20 Tasks

## Design
- `server/src/resellers/`: `plans.ts` (plan CRUD, seeds), `resellers.ts` (reseller, quota, brand), `keys.ts` (API keys, hashed, shown once), `callbacks.ts` (HMAC-signed POST, retry, SSRF check reusing `url/`), `subscriptions.ts` (Razorpay Subscriptions, signed webhook, idempotent), `routes.ts` (`/resellers` dashboard API, `/api/v1` key API).
- Collections: `resellerPlans`, `resellers`, `resellerKeys`, `resellerEvents` (webhook ids seen), `resellerCallbacks` (delivery queue).
- Quota is claimed atomically when a build starts (same pattern as F14 unlock), given back if the build is refused before it queues.
- Builds a reseller starts go through the existing `builds/start.ts`, marked `resellerId`; Premium signing (F13) and ads (F16) are reused unchanged.
- Callback deliveries are claimed in the database so each attempt is sent once; retries with backoff.
- Admin: new "Resellers" and "Plans" tabs in `/admin`; every write goes through the F17 audit log.
- Client: `/r/:slug` dashboard themed by the reseller's brand; `noindex`.
- Payments stay behind the existing off switch. T7 is a monthly one-off order (decided with the owner, no recurring). Plan orders live in `resellerOrders`, reusing F14's provider, webhook and sweep through a hook in `applyEvent`; each paid order is applied to the reseller once (`appliedOrders`), extending `paidUntil` by a month and starting the quota again.

## Slices
- [x] T1: Plans and resellers data, admin create/edit/suspend, audit (R1, R2, R10, R10a)
  - Tests first: AC1, AC10
- [x] T2: Quota claim, reset and over-quota refusal (R4, R9, R11)
  - Tests first: AC3, AC7, AC8
- [x] T3: API keys and key API: create app, build, status, rate limit (R7, R11)
  - Tests first: AC5, AC8
- [x] T4: Signed callbacks with retry and SSRF check (R8)
  - Tests first: AC6
- [x] T5: White-label dashboard and branded download page and email (R5, R6)
  - Tests first: AC4
- [x] T6: Admin Resellers and Plans tabs (R10, R10a)
- [x] T7: Monthly payment by hand: checkout, verify, webhook, sweep, lapse, admin cancel and reinstate (R3, R9)
  - Tests first: AC2
- [x] T8: Reseller emails via the F18 module (R12)
  - Tests first: AC9
- [x] T9: Deploy (payments off), verification, owner sign-off
