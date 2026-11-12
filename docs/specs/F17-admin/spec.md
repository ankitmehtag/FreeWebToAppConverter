# F17 Admin

Status: approved

## Goal
A small, safe admin panel so the owner can see how the product is doing and fix problems (a stuck build, a wrong plan, a refund) without SSH. Every admin action is recorded.

## Out of scope
- Multiple admin roles or teams (one owner account only for now).
- Editing prices per currency (F22).
- Support inbox or email templates (F18).

## Requirements
- R1: Only accounts listed in an `ADMIN_EMAILS` server setting can use admin routes; everyone else gets 404, never 403.
- R2: Admin signs in with the normal login plus a second step (TOTP 2FA); admin routes refuse a session without it.
- R3: Overview page: users, apps, builds (last 24 h / 7 d, success rate, median build time), queue length, paid orders and revenue.
- R4: Users list with search by email; user detail shows their apps, builds and orders.
- R5: Apps and builds lists with filters (status, plan); a build detail shows its log and error.
- R6: Actions: set an app's plan (free / premium), retry or cancel a build, disable or enable a user, refund an order (same logic as `refund-order`), create a coupon.
- R7: Every action is written to an append-only audit log (who, what, target, time, reason), and the log is viewable in the panel.
- R8: The panel never shows secrets: no keystore passwords, no API keys, no webhook secrets.
- R9: Admin routes are rate limited and not indexed by search engines.

## Acceptance criteria
- AC1 (R1): Given a non-admin signed-in user, when they call any `/admin` route, then the response is 404.
- AC2 (R2): Given an admin session without 2FA, when it calls an admin route, then it is refused until the TOTP code is verified.
- AC3 (R3): Given known test data, when the overview loads, then the counts match the database.
- AC4 (R4, R5): Given a user email, when searched, then their apps, builds and orders are listed.
- AC5 (R6): Given a free app, when the admin sets it to premium, then the plan changes and one audit entry exists.
- AC6 (R6): Given a paid order, when the admin refunds it, then the order is marked refunded once, even if clicked twice.
- AC7 (R7): Given any action, when it completes, then the audit log has an entry that cannot be edited or deleted through the API.
- AC8 (R8): Given any admin response, when scanned, then it contains no secret values (reuse `scan-secrets`).

## Open questions
- Q1: Is the admin just your email, set in `ADMIN_EMAILS`? Proposed: yes, one email.
- Q2: 2FA by authenticator app (TOTP, free). Proposed: yes, no SMS cost.
- Q3: Should the panel live at a hidden path on the same site (`/admin`) or a separate subdomain? Proposed: same site, `/admin`, no new cost.
- Q4: Refund from the panel: allowed for any order, or only within 7 days? Proposed: any order, with a required reason.
