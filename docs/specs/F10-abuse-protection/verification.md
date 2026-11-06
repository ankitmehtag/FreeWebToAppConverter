# F10 Verification

Run on 2026-11-07. Automated tests used Mongo, Redis and SeaweedFS from Compose, and the worker suite ran its Docker container tests. Browser rows ran in headless Chromium (Playwright) against the Compose API and the Vite dev server, with mail sent to Mailpit, and the takedown ran through `npm run takedown -w server` on the F09 proof app and its R2 APK.

Status: all remaining criteria pass. AC5 and AC6 were removed with the brand denylist by the owner on 2026-11-07. Signed off by the owner on 2026-11-07. The unsafe-site check is proven with a test provider only, as agreed: it stays off until a Web Risk key is set before launch.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w server` (unsafe), test provider listing Google's test malware and phishing pages | Saving the phishing page 400 with the unsafe message; build start 409 `unsafe_site` with no build stored; provider down at build start 503 `safety_check_unavailable` with no build stored, then 201 once it answers | pass |
| AC2 | `npm test -w server` (unsafe) | A clean start URL redirecting to the phishing page is `unsafe` in the URL check and 409 at build start; a listed internal host is refused on save and at build start | pass |
| AC3 | `npm test -w server` (unsafe) | One URL checked twice reaches the provider once | pass |
| AC4 | `npm test -w server` (unsafe); `npm test -w client` | `/url/check` answers exactly `{ reachable: false, failure: 'unsafe' }`; a clean site passes; a provider outage fails open; the wizard explains and keeps Next disabled | pass |
| AC5 | Removed with R6 to R9 on 2026-11-07 | `npm test -w server` (apps): `https://www.google.com/` named `Google` with package `com.google.app` saves | removed |
| AC6 | Removed with R6 to R9 on 2026-11-07 | | removed |
| AC7 | `npm test -w server` (reports); browser at phone size with no account | Report stored with app, build, reason, details and email, and no IP; email to the reports address with the app's details. Browser: the install page form sent an impersonation report, showed the thanks message, and Mailpit got "App report: impersonation, F09 Proof" | pass |
| AC8 | `npm test -w server` (reports) | One visitor reporting one app twice leaves one updated report and one email; the 11th report from one IP answers 429 | pass |
| AC9 | `npm test -w server` (takedown); `npm test -w worker`; browser with the takedown command | Download and install links answer 410, the APK object is gone, the queued build is `canceled`, builds, saves and icon uploads 403 `taken_down`, and the app shows its reason; a build running during a takedown fails before upload. Browser: "Deleted 1 APK(s)", the install link showed "This link has expired", the owner's download 410, the wizard showed the reason with no build button, and the build page said its APK was removed | pass |
| AC10 | `npm test -w server` (takedown); browser with `--restore` | Both actions stored with operator, reason, time and the deleted key; builds allowed again; restoring an app that isn't down is refused. Browser: after restore the build button returned and the old download stayed 410 | pass |
| AC11 | `npm test -w server` (proxy) | Behind a trusted proxy, two visitors have separate limits; with no trusted proxy, forged `X-Forwarded-For` values all share one limit | pass |

Automated totals: `shared` 69 of 69, `server` 239 of 239, `client` 36 of 36, `worker` 100 of 100, typecheck 0 errors.

## Known limits
- The unsafe-site check is off until `WEB_RISK_API_KEY` is set, by the owner's choice not to pay for anything yet. Web Risk's Lookup API is free for the first 100,000 calls a month. It must be switched on, and Google's real test URLs checked, before launch.
- A report can be sent only while the install link's record exists, which is about an hour. A report link inside the APK waits for a later feature.
- A taken-down app still lets the owner type in the wizard, but every save is refused. The screen could lock its fields in a later pass.
- With the denylist removed, an app may use any brand's site and name. Phishing that isn't on the unsafe-site list is caught only through reports and takedowns, and Google Play may reject such apps for impersonation.
