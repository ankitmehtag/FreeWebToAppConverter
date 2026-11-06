# F09 Verification

Run on 2026-11-06 and 2026-11-07. Automated tests used Mongo, Redis and SeaweedFS from Compose, and the worker suite ran its Docker container tests. The browser rows ran in headless Chromium (Playwright) against the Compose API, the Vite dev server, a worker on the host with the test key, and R2. Mail went to Mailpit.

Status: all criteria pass, signed off by the owner on 2026-11-07.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w server` (builds) | Another user's app 404; an unfinished app 409 `not_ready`; an unverified owner 403 `email_unverified`; no job queued and no build stored for any of them | pass |
| AC2 | `npm test -w server` (builds); browser: double-clicked "Build app" | 10 parallel starts with one key make one build, one 201; a second start while one runs is 409 `build_running` with that build's id; the double click opened one build page | pass |
| AC3 | `npm test -w server` (builds) | 20 parallel increments give codes 1 to 20 once each; builds one after another get 1, 2, 3; version name kept and repeated by default | pass |
| AC4 | `npm test -w server` (builds) | 4th build in 24 hours is 429 `daily_limit` with `nextAllowedAt` = first build + 24 hours; an infrastructure failure and a build older than 24 hours don't count; 6 parallel starts on 6 apps give exactly 3 builds | pass |
| AC5 | `npm test -w worker` (build) | A website build uses the icon copy and the config taken at the start, frees the app's slot, and sets `lockedAt` once; a later success keeps the first lock time | pass |
| AC6 | `npm test -w worker`; `npm test -w server` (build-events); browser | Lines published in order with numbers, then `building`, `signing`, `uploading`, `success`; a late viewer gets earlier lines first, then live ones, then `end`; a missed end is noticed by polling; another user 404. Browser: 6 live lines while `Building`, a second tab opened late started at "Welcome to Gradle 8.11.1!", 78 lines at the end | pass |
| AC7 | `npm test -w worker`; searched the browser log, `buildLogs` and the build record of build `d825cea6…` | Signing passwords, keystore path, work folder, host paths, an R2 secret in the environment and credential assignments are all `[hidden]` or `[path]`; the real build's log and records hold none of the test password, `/Users/`, `.sitetoapk`, the R2 keys or `JWT_SECRET` | pass |
| AC8 | `npm test -w worker`; `npm test -w client` | `input`, `compile`, `timeout` and `check` failures recorded and counted; our own failure is `infra` with `countsTowardLimit: false`, only after the last attempt; the page explains each and offers to try again | pass |
| AC9 | `npm test -w server`; browser | The owner is redirected to a 1-hour signed link whose file matches the SHA-256; another user 404; an expired build 410 and the page offers a new build; the apps page shows each app's latest build and its last 10. Browser: downloaded APK SHA-256 `fe88ab9d…` matches the page; the apps list shows "v1.0 · Ready" | pass |
| AC10 | `npm test -w server`; browser at phone size with no cookies; the owner scanned the QR code on the moto g35 5G | The link lasts 1 hour and stores only a hash; it fails after an hour and once the APK is deleted. Browser: install page opened on `192.168.1.7` with icon, name, version and size, and its download matches the SHA-256. Phone: install page opened with no sign-in, the APK downloaded and installed, and "F09 Proof" opened the site | pass |
| AC11 | `npm test -w server` (builds) | Missing CSRF 403; extra fields, a short key and a bad version name 400; signed out 401; rapid starts 429 | pass |

Automated totals: `shared` 69 of 69, `server` 219 of 219, `client` 32 of 32, `worker` 99 of 99, typecheck 0 errors.

## Known limits
- The server doesn't set Express's `trust proxy`, so behind any proxy every visitor shares one IP for every rate limit, including the sign-in IP limit. In local tests the Vite proxy made the phone, scripts and curl share one IP. Production setup (F11, F12) must set it for the real proxy.
- The first phone try showed "This link has expired" because the shared install limit had answered 429. Fixed: only downloads are limited now, and the page tells a busy server apart from an expired link.
- An install link can be opened by anyone who has it for its hour, as agreed in Q3.
- Gradle prints "Couldn't poll for events" under amd64 emulation on the Mac. It is file-watcher noise and doesn't affect the build.
- Builds on the Mac take about 4 minutes because the builder runs under emulation. Production timing is measured on real build hosts.
