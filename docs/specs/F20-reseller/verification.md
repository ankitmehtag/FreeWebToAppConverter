# F20 Verification

Run 2026-11-16 on the developer Mac against real Mongo, Redis and the local S3 (Docker), before deploy. "Test" means a vitest file written from the criterion before the code.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 (R1, R2) plans, reseller, branded page | `npx vitest run test/resellers-admin.test.ts` (server) | 9 passed: three seed plans listed; reseller created; `/resellers/<slug>/brand` shows brand and no `userId`/`terms`/`quota`; suspended reseller 404 then back | pass |
| AC2 (R3) paying a month | `npx vitest run test/resellers-billing.test.ts` | 15 passed: modal, webhook and sweep each add one month once; replay, double verify and a wrong amount change nothing; early payment adds to the end of the paid month; a dropped paid order is finished by the sweep | pass (fake provider) |
| AC3 (R4) quota | `npx vitest run test/resellers-quota.test.ts` | 7 passed: build N+1 refused (429), renewal starts it again, two builds at once take the last one only, a refused start gives the build back | pass |
| AC4 (R5, R6) brand and Premium | server `resellers-brand.test.ts` (4), worker `notify.test.ts` (5), client `reseller.test.tsx` (9) | reseller apps are Premium and may use ads; download page and email carry the brand (escaped, colour checked); dashboard shows brand, quota, `noindex`, 404 for another slug | pass |
| AC5 (R7) keys and key API | `npx vitest run test/resellers-api.test.ts` | 9 passed: key shown once, only a hash stored; app, icon, build and status by key alone; revoked or wrong key 401; 60 a minute per key; other routes 404; builds count against quota | pass |
| AC6 (R8) callbacks | `npx vitest run test/resellers-callbacks.test.ts` | 9 passed: HMAC-SHA256 over `t.body` verifies; retried with backoff then given up; once per build across overlapping sweeps; private, loopback, link-local and `http` URLs refused and never retried; a real local receiver got the body and header | pass |
| AC7 (R9) lapsed plan | `resellers-quota.test.ts`, `resellers-billing.test.ts` | lapsed: new build 402, old build still readable; past its paid month the plan lapses once, with one email; paying lifts it; an admin-set reseller never lapses | pass |
| AC8 (R10, R11) isolation and suspend | `resellers-api.test.ts`, `resellers-quota.test.ts` | reseller B gets 404 for A's app, build and list; suspended reseller's key 403 and builds 403 | pass |
| AC9 (R12) emails | `npx vitest run test/resellers-notices.test.ts` | 4 passed: warning once a month at four-fifths and again after renewal; started, renewal-due and cancelled once per event; a down mail service breaks nothing and logs no address | pass |
| AC10 (R2, R10, R10a) admin edits | `resellers-admin.test.ts`, client `admin-resellers.test.tsx` (11) | new price reaches a new joiner, an existing reseller keeps the old one, quota applies now only when asked, brand/callback/quota edited, every change in the audit log, lists never carry a secret or hash | pass |
| Whole suites | `npx vitest run` in server, client, worker | server 37 files / 486 passed; client 8 / 102 passed; worker 139 passed (after the first run had 9 failures in `storage.test.ts` and `links.test.ts`, caused by the local S3 container running out of volume slots, not by F20; fixed by recreating the container) | pass |
| Types and build | `npx tsc -p tsconfig.json` (server, client), `npm run build` (client) | no errors; pages prerendered | pass |
| Secrets | `npx tsx server/scripts/scan-secrets.ts server/src shared/src worker/src client/src docs/specs/F20-reseller` | `Nothing found`, exit 0 | pass |
| Live: a real Razorpay plan payment | Pay once from a reseller dashboard on production | not run | pending (the owner deferred real payment tests until the whole product is built) |
| Live: dashboard, install page and email in a real browser and Gmail | Owner opens `/r/<slug>`, an install link and a build email | not run | pending owner |
| Live: callback to a real receiver | Owner points a callback at a public URL (for example a request catcher) and builds | not run | pending owner |

## Found and fixed during the build
- A reseller's builds were held to the 3-a-day limit of an ordinary account. The monthly quota is now their limit (R4).
- Admin lists first returned raw database rows, including the callback secret. They now return views without secrets.

## Deploy notes
- No new environment variable. New collections (`resellerPlans`, `resellers`, `resellerKeys`, `resellerOrders`, `resellerCallbacks`, `resellerNotices`) and their indexes are created at server start. Needs MongoDB 5 or later (production runs 7).
- The builder image is unchanged (still v5), so no image scan is needed.
- The reseller Pay button shows only where Razorpay keys are set on the server. Resellers exist only when the admin creates them.

## Deployed 2026-11-16 (commit d5dc310)
| Step | Result |
|---|---|
| `git pull`, `npm ci`, `npm run build -w client` on the server | done |
| `docker compose -f compose.prod.yml up -d --build --wait` | api, shot, caddy, mongo, redis healthy |
| `systemctl restart sitetoapk-worker` | active, image `sitetoapk-builder:v5` |
| Caddy: `/resellers` and `/api/v1` were missing from the API routes, so the site's page answered them. Fixed in `deploy/Caddyfile` (d5dc310), Caddy restarted | `/resellers/nobody/brand` 404 JSON, `/resellers/me` 401, `/api/v1/apps` 401 `Invalid API key`, `/admin/api/plans` 404 for visitors, `/r/anything` and `/pricing` still the site, `/health` 200 |
| New collections on production | `resellerCallbacks resellerKeys resellerOrders resellerPlans resellers`; 3 seed plans, 0 resellers; no errors in the API log |

Sign-off: owner, 2026-11-16. The three live checks above (a real plan payment, the pages and email in a browser and Gmail, a real callback receiver) were not run before sign-off; the real payment test stays deferred with the other payment tests.
