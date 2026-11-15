# F20 Reseller

Status: done

## Goal
An agency (a reseller) pays a monthly plan, gets a build quota, and uses a white-label dashboard to create and build Premium apps for its own clients under its own brand. Resellers can also drive builds through an API key and get a signed callback when a build finishes (the original F20 scope).

## Out of scope
- Custom domains for the reseller dashboard (it lives at `/r/<slug>`; revisit later).
- Reseller-of-reseller, sub-accounts with separate logins for the reseller's clients.
- Paying per app through this flow: single-app Premium stays as in F14.
- Recurring auto-charge (see R3), a pre-expiry reminder, receipts and refunds for plan payments (a refund or dispute is recorded but does not end the plan; the admin cancels it by hand), and multi-currency plans (F22). Plans are INR only, as F14.
- A free trial, proration, and tax invoices (GST is still not handled, as F14).

## Requirements
- R1: An admin can create a reseller for an existing user, with a name, slug, brand name, logo URL and accent colour.
- R2: Plans are defined and editable by the admin (name, monthly price in INR, builds per month, API on/off, "built with" line on/off, active/hidden). Three seed plans. Nothing about a plan is hard-coded.
- R3: (Changed by the owner, 2026-11-16: no Razorpay recurring.) A reseller pays for each month by hand, with a normal Razorpay order through the same Standard Checkout, signed webhook and sweep as F14, at the price of the plan they joined. Each paid order extends the plan by one month (from the end of the current month if it is still running), starts the month's quota again, and lifts a lapse. A plan not renewed by the end of its paid month lapses (R9) and the reseller is emailed. The admin can also cancel a reseller's plan and reinstate it. Every step is idempotent, so a replayed webhook or a retried verify changes nothing.
- R4: A reseller's quota is the plan's builds per month, reset at each paid renewal. A build over quota is refused with a clear message; unused quota does not carry over. A reseller's builds are not held to the daily limit of an ordinary account: the monthly quota is their limit.
- R5: The white-label dashboard at `/r/<slug>` shows the reseller's brand (name, logo, accent) instead of ours, and lists the reseller's client apps, builds, and remaining quota. Builds made there are Premium-signed (F13) and ad-free unless the reseller enables ads (F16).
- R6: Output the reseller delivers (download page, build-ready email) carries the reseller's brand, with a small "built with" line that the plan may remove.
- R7: API: a reseller creates keys (shown once, stored hashed, revocable) and can create an app, start a build, and read build status. Requests are rate limited per key and count against quota.
- R8: Signed callbacks: a reseller sets a callback URL; when a build finishes or fails we POST JSON signed with HMAC-SHA256 (secret per reseller), with a timestamp, retried with backoff, and URLs pointing at private addresses are refused (same SSRF rules as F07).
- R9: If a plan lapses, existing apps and downloads keep working; new builds are refused until it is paid.
- R10: Everything in this feature is manageable from the admin panel (F17): create, edit, suspend and reactivate resellers; edit their brand, slug, callback URL and plan; add or reset quota by hand; revoke API keys; cancel a subscription; edit plans and prices; see quota use and subscription state. Every admin change is written to the admin audit log.
- R10a: Changing a plan's price or quota applies to new subscribers at once. Existing subscribers keep their old price until they move (Razorpay plans cannot be edited, so a price change creates a new Razorpay plan behind the scenes); quota changes apply from the next renewal unless the admin applies them now.
- R11: A reseller can see only its own data; one reseller can never read or build for another's apps.
- R12: Emails (F18 module): subscription started, payment failed, quota nearly used (80%), subscription cancelled.

## Acceptance criteria
- AC1 (R1, R2): Given an admin, when a reseller and plans are created, then they show in the admin panel and the dashboard loads at `/r/<slug>` with the brand.
- AC2 (R3): Given a reseller's checkout, when it is paid (by the verified modal result, a signed webhook or the sweep), then the plan runs one more month and the quota starts again; a replay or a second path changes nothing, a wrong amount activates nothing, and a plan past its paid month lapses until the next payment.
- AC3 (R4): Given a plan of N builds, when N+1 builds are requested in a month, then the last is refused; after a paid renewal the quota is N again.
- AC4 (R5, R6): Given a reseller build, when it finishes, then the dashboard, download page and email show the reseller's brand.
- AC5 (R7): Given an API key, when an app is created and built, then status can be read; a revoked key gets 401; the key is not stored in clear text.
- AC6 (R8): Given a callback URL, when a build finishes, then the receiver can verify the signature; a failing receiver is retried; a private-IP URL is rejected.
- AC7 (R9): Given a lapsed plan, then old downloads work and a new build is refused.
- AC10 (R2, R10, R10a): Given the admin edits a plan's price and quota, then a new subscriber gets the new values, an existing subscriber keeps the old price, and each change is in the audit log; given the admin edits a reseller's brand or adds quota, then the dashboard shows it on reload.
- AC8 (R10, R11): Given reseller A's key or session, when it asks for reseller B's app, then it gets 404; admin can suspend A and A's builds stop.
- AC9 (R12): Each email is sent once for its event.

## Open questions
- Q1: Settled 2026-11-16: the owner chose the fallback, a monthly payment by hand. Recurring Razorpay Subscriptions can replace it later without changing quota, lapse or emails.
- Q2: Plan prices and quotas are only starting values, editable later in admin. Proposed seeds: Starter ₹999 (10 builds), Growth ₹2,499 (30 builds, API), Agency ₹5,999 (100 builds, API, no "built with" line).
- Q3: Does the reseller's end client ever see a login or pay us? Proposed: no, the client only receives the download link and email.
- Q4: Payments are still deferred in production until the whole product is built. Proposed: build F20 behind the same off switch.
