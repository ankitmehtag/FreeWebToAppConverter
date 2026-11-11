# Free Website to App Converter features

The status tracker for every feature. The workflow is in [specs/README.md](specs/README.md), and the full product plan is in [PLAN.md](PLAN.md).

**Status values:** not started, spec draft, spec approved, in progress, verifying, done.

Only one feature is in progress at a time. The riskiest part (website to working signed APK) comes first, so problems surface before time goes into the web UI.

## Phase 1: free APK builder (MVP)

| Feature | Slices | Must be proven before sign-off | Status |
|---|---|---|---|
| **F01 Foundation** | Repo scaffold, Docker Compose with Mongo and Redis, health endpoint, versioned `app_config` schema | Fresh `docker compose up` works; health reports Mongo and Redis status; schema tests reject bad URL, bad package name and missing version | done |
| **F02 Android app** | WebView shell, hardening, behaviour toggles, upload/download/popups and link schemes, Google sign-in fallback | APK runs on `Medium_Phone_API_36.1`; every toggle tested on and off; bad SSL page stays blocked; `file://` blocked; upload, download and sign-in fallback checked on a real device | done |
| **F03 App generation** | Safe file renderer, icon pipeline, watermark injection | Hostile app name builds and displays literally; fake or undersized PNG rejected; editing `app_config.json` can't remove the watermark | done |
| **F04 Build engine** | Builder image, container isolation, queue and worker, reaper | Offline build passes `apksigner verify` and `aapt2 dump badging`; key absent from image layers; Redis, Mongo, API and Docker socket unreachable from inside; timeout kill works; killing the worker mid-build recovers; no orphan containers | done |
| **F05 Artifact delivery** | R2 upload, signed links, checksum, expiry | Download matches SHA-256; expired link fails. **A script now turns a config into a signed APK that installs and runs** | done |
| **F06 Accounts** | Email login, verify and reset emails, login protection, Google login | Token reuse and missing CSRF rejected; expired or reused links fail; lockout triggers and recovers; no duplicate account for the same email | done |
| **F07 URL safety** | SSRF-safe fetcher and URL checker | Passes private IP, metadata IP, redirect, DNS rebinding, IPv6, decimal and octal IP cases | done |
| **F08 App creation** | App records, wizard steps, site prefill, permissions, phone preview | Users can't reach each other's apps; package name locks after first build; refresh keeps the draft; built APK requests only expected permissions; preview works on an embeddable and a blocking site | done |
| **F09 Build experience** | Start build, live logs, My Apps, download, QR install | Double-click creates one build; parallel requests never reuse a versionCode; 3/day limit enforced; no secrets in logs; QR install works on a real phone | done |
| **F10 Abuse protection** | Safe Browsing, report link, takedown (brand denylist removed by the owner) | Google's test URL blocked; takedown revokes the download link | done |
| **F11 Public website** | Landing, pricing, FAQ, legal, SEO, URL checker | Pages render on mobile and desktop; checker uses F07 | done |
| **F12 MVP sign-off** | Playwright end-to-end, 20-build load test, sample build script | Sign up, create, build, install and site load are automated; load test shows no orphans, leaks or secrets | done |

## Phase 2: paid product

Slices and proof are defined when each feature's spec is written.

| Feature | Includes | Status |
|---|---|---|
| **F13 Premium signing** | Per-app keystore, AAB, white label | spec approved |
| **F14 Payments** | Plans, Razorpay, Stripe, refunds, reconciliation, coupons | spec approved |
| **F15 Push** | Platform FCM first, then bring-your-own credentials | not started |
| **F16 Ads** | AdMob and consent | not started |
| **F17 Admin** | Admin panel, audit log, 2FA | not started |
| **F18 Email** | Remaining email templates | not started |

## Phase 3: growth

| Feature | Includes | Status |
|---|---|---|
| **F19 Domain verification** | Ownership check and assetlinks helper | not started |
| **F20 Reseller** | Plans, API, signed callbacks | not started |
| **F21 Showcase and add-ons** | Showcase, publishing help | not started |
| **F22 Multi-currency** | Admin-set prices per currency | not started |

## Known risk

Android build tools are x86-64 on Linux, so an Apple Silicon Mac runs the builder image under emulation. F04 will measure this; local timings won't indicate production speed.

## Accounts needed along the way

- F05: Cloudflare R2
- F06: Resend, Google OAuth client
- Before launch: add the `freewebsitetoappconverter.com` callback URL to the Google OAuth client. The domain is verified in Resend (2026-11-06).
- Before launch: a Google Web Risk API key on its free tier, to switch on F10's unsafe-site check
- Before launch: `support@freewebsitetoappconverter.com` can receive mail. The owner chose to launch with F11's Terms, Privacy and Acceptable Use as they are, keeping the "Draft" note on the pages, and to review them properly one week after going live (owner, 2026-11-07)
