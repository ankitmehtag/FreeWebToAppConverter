# F10 Tasks

## Design
- `createApp` takes a `trustProxy` option from the `TRUST_PROXY` setting and passes it to Express's `trust proxy`. Empty means Express's default, which ignores `X-Forwarded-For`, so `req.ip` is the socket address.
- The brand denylist (T2) was built and then removed on the owner's decision of 2026-11-07, together with its punycode decoder.
- `server/src/abuse/unsafe.ts` defines `UnsafeChecker = (urls: string[]) => Promise<'safe' | 'unsafe'>`, which throws when the provider can't answer. `webRiskLookup(key)` calls `uris:search` for malware, social engineering and unwanted software, and `createUnsafeChecker(redis, lookup)` caches each URL's answer in Redis: a listed URL until the `expireTime` Google gives, a clean one for 30 minutes. With no `WEB_RISK_API_KEY` there is no checker, and every check is skipped.
- Where it runs: `/url/check` checks the start URL and the final URL, and answers `unsafe`; saving a draft checks a changed start URL and changed internal hosts; build start fetches the start URL for its final URL, then checks it with the start URL and every internal host. The wizard and save fail open when the provider is down. Build start fails closed with reason `safety_check_unavailable`. Both build-start refusals happen before the build is inserted, so they never count.
- Reports: `POST /reports` takes an install token, a reason, optional details (up to 1,000 characters) and an optional email. It needs no session. It finds the build through the token, stores the report in `abuseReports` keyed by app and a reporter hash (an HMAC of the IP), so a repeat updates the same report, and emails `REPORTS_EMAIL` when it is set. It is limited per IP.
- Takedown: `npm run takedown -w server -- <appId> --reason "…" --operator "…"` and `--restore`. A takedown sets `takenDown` on the app, cancels its queued builds, deletes each build's APK object and unsets `artifactKey`, deletes its install tokens, and stores a record in `takedowns`. The routes refuse saves, icon uploads and builds for a taken-down app with reason `taken_down`, and the app view carries the reason. The worker checks the app just before upload, so a build already running can't publish an APK. Restore clears `takenDown` and stores its own record.

## Slices
- [x] T1: Visitor IP behind a trusted proxy (R16)
  - Tests first: AC11
- [x] T2: Brand denylist (R6, R7, R8, R9), removed by the owner on 2026-11-07
- [x] T3: Unsafe-site provider, cache, URL check, save and build start (R1, R2, R3, R4, R5)
  - Tests first: AC1, AC2, AC3, AC4 with a fake provider
- [x] T4: Reports from the install page, with email (R10, R11, R12)
  - Tests first: AC7, AC8
- [x] T5: Takedown and restore, with the owner's view (R13, R14, R15)
  - Tests first: AC9, AC10
- [x] T6: Browser proof of the report and takedown
