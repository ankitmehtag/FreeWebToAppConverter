# Website-to-Android App Builder — Improved Feature Plan (v2)

## Context
SaaS that turns a responsive website into a signed Android APK/AAB. Scope reference: freewebsitetoapp.com (features and pricing only; own brand, UI and code).
Stack: React + Vite (client), Node + Express (API), MongoDB Atlas, Docker build worker (Node + JDK 17 + Android SDK + Gradle). Android only; iOS later.
This v2 keeps the original 11 modules (A–K) and fixes gaps, contradictions and risks found on review. Changes are marked **[NEW]** or **[FIX]**.

## Starting point
**Greenfield, from zero.** Earlier prototypes on this machine (WrapMySite, `WebToAppConverter/convert.mjs`) are deliberately not reused.
Local dev notes: AVD `Medium_Phone_API_36.1` exists for runtime tests; port 5173 is often taken.
**Builds run in Docker containers on our own worker hosts.** No GitHub Actions.

## Decisions made (2026-10-31)
These override anything below that says otherwise. Feature order and status are tracked in `docs/FEATURES.md`.

| Item | Decision |
|---|---|
| Folder | `WebToAppCOnverter/{client,server,worker,android-template,shared}` (one repo). `shared/` holds zod schemas + the `app_config` JSON schema used by server, worker and template |
| Product name | Free Website to App Converter, matching the domain. The Android package prefix stays `com.sitetoapk.*`, because it never shows to users and package names can't change later. |
| Domain | `freewebsitetoappconverter.com`, purchased. |
| Plans | Free and Premium only. Starter is dropped from the MVP. |
| Email | Verify and reset emails move to Phase 1, via Resend, with Mailpit locally. |
| Free tier | Watermark only in Phase 1, no ads. |
| CI | No GitHub Actions. A sample build script runs on a worker host before each builder image rollout. |
| Backend | Express and MongoDB as planned, not the InsForge backend in `~/AGENTS.md`. |
| Queue | **[FIX]** Agenda is in maintenance mode; use **BullMQ + Redis** (retries, concurrency, rate limit, stalled-job recovery). Mongo `builds` stays the source of truth for status. |
| Object storage | Cloudflare R2 (S3 API, no egress fee). |

## Architecture
```
client (React) ─► server (Express) ─► MongoDB Atlas
                       │ enqueue (BullMQ)
                       ▼
                     Redis ─► worker service (Node, consumes jobs)
                                  │ docker run per build (ephemeral container:
                                  │ JDK17 + Android SDK + warm Gradle cache)
                                  ▼
                           R2 (signed download URLs) ◄── client
```
- API never builds. The worker service pulls a job, starts **one fresh container per build** from the builder image, collects artifacts, uploads to R2, updates status in Mongo.
- Container limits: `--cpus`, `--memory`, `--pids-limit`, read-only root fs with a tmpfs work dir, non-root user, no Docker socket inside, hard timeout (15 min) then `docker kill`, container removed after (`--rm`).
- Network: egress only to Maven Central / Google Maven (or none, using a pre-baked offline Gradle dependency cache in the image — faster and safer). No access to internal services.
- Speed: builder image ships the Android SDK, build-tools and a warmed Gradle cache (template dependencies pre-resolved); Gradle runs with `--offline --no-daemon` per container. Target p50 < 3 min.
- Secrets: shared Free/Starter signing key and decrypted Premium keystores are mounted into the container as files for the run only (tmpfs), never baked into the image or passed as build args.
- Scaling: run N worker hosts; BullMQ concurrency per host = CPU cores / 2. Queue depth metric drives adding hosts.
- Live logs: worker streams container stdout to Redis pub/sub → API serves SSE; persisted to `buildLogs` on finish.
- Failure handling: BullMQ stalled-job recovery; a reaper marks builds stuck past timeout as `failed` and kills orphan containers.
- Builder image is rebuilt and versioned on every template/SDK bump; CI builds a sample app with the new image before rollout.

## Modules (A–K) with improvements

### A. Public website
Landing, platforms, feature grid, curated showcase, pricing (multi-currency), About/Contact/FAQ, legal pages, SEO (meta, sitemap, OG). Unchanged.
- **[NEW]** Legal pages must include acceptable-use rules (see "Abuse & Play Store policy").
- **[NEW]** Public "App Preview" / URL checker on landing page (enter URL → reachability, HTTPS, responsive check) as the conversion hook; same SSRF-safe checker as the wizard.

### B. Auth & account
Email/password (bcrypt + JWT in httpOnly cookie), Google OAuth, email verify, forgot/reset, profile, roles `user | reseller | admin`.
- **[NEW]** Short-lived access token + rotating refresh token (cookie `SameSite=Lax`, CSRF token for state-changing calls since cookie auth).
- **[NEW]** Account deletion = delete apps, builds, keystores, artifacts, with a 7-day grace for Premium keystores (losing the keystore means no Play updates; warn and force a download first).
- **[NEW]** Login rate limit + lockout; email-verification required before first build.

### C. App creation wizard (core)
Steps: Basic info → Branding → Theme → Behaviour → Permissions → Push → Monetization → Review/Build. Live phone-frame preview.
- **[FIX]** Many sites send `X-Frame-Options`/CSP `frame-ancestors`, so an iframe preview often shows blank. Preview strategy: try iframe; if blocked (detect by server-side header check), show a server-rendered screenshot (headless Chromium, SSRF-safe, cached) plus the note "your site blocks embedding; the real app is unaffected".
- **[NEW]** Auto-fetch site favicon, `theme-color`, title and `manifest.json` to prefill name, colours and icon.
- **[NEW]** Package name validation: Java identifier rules, no reserved words, unique per user, immutable after first successful build.
- **[NEW]** Icon: require ≥512×512 PNG; generate all mipmaps, adaptive icon (foreground safe zone 66%), monochrome themed icon, Play Store 512 icon.
- **[NEW]** Draft autosave; wizard state persists server-side; "duplicate app".
- **[NEW]** Config schema versioned (`schemaVersion`) so old apps can be rebuilt after template upgrades.
- Behaviour toggles (unchanged): progress bar, pull-to-refresh, exit dialog, offline screen, external-link allow-list, deep links, upload/download, zoom/orientation/fullscreen, UA suffix, cache mode.
- **[NEW]** Extra toggles worth the small cost: JS enabled/DOM storage default-on, mixed-content policy (block), third-party cookies, custom error page, status-bar/navigation-bar colour, optional bottom navigation (up to 5 URLs), swipe-to-navigate. Defer anything not in MVP.
- **[FIX]** Permissions: derive automatically from enabled features (upload → camera/media picker, geolocation, notifications) and let the user remove, instead of a free pick list. Android 13+ `POST_NOTIFICATIONS`, Photo Picker avoids broad storage permission.
- **[FIX]** Deep links: App Links need `/.well-known/assetlinks.json` on the user's domain containing the app's signing cert SHA-256. Show the exact JSON to paste after build (shared key SHA for Free/Starter; user's key for Premium). Domain verification status shown in dashboard.
- Push: Firebase or OneSignal. **[FIX]** see Push section — `google-services.json` alone cannot send messages.
- Monetization: AdMob IDs, banner/interstitial, frequency. **[NEW]** Validate ID formats (`ca-app-pub-…~…`), add consent (UMP/GDPR) prompt when ads enabled.

### D. Android template
Kotlin, minSdk 24, **targetSdk 35 now, bump to 36 as Play requires** (**[NEW]** tracked in a single `template/version.json`; CI rebuilds a sample app on every bump).
- Single `WebViewActivity` + `SplashActivity` (use AndroidX SplashScreen API on 12+); config from `app_config.json` in assets; Gradle placeholders for applicationId/versionCode/versionName.
- All wizard toggles, back navigation via WebView history, `onShowFileChooser`, `DownloadListener`, permission bridges.
- Compile-time flavors/source sets for FCM, OneSignal, AdMob so disabled features add no code, libraries or permissions.
- JS bridge `window.AppBridge`: share, toast, vibrate, FCM token, open external. **[FIX]** Security: `addJavascriptInterface` exposed only to origins in the allow-list (check `WebViewCompat.addWebMessageListener` with allowed origin rules), never to third-party frames; all methods `@JavascriptInterface` with input validation.
- **[NEW]** WebView hardening: `setAllowFileAccess(false)`, `allowContentAccess(false)`, safe browsing on, block `file://`/`javascript:` navigation from web content, HTTPS-only unless user explicitly opts in (cleartext traffic config).
- **[NEW]** Handle `intent://`, `tel:`, `mailto:`, `market:` schemes; handle HTTP auth, SSL errors (never auto-proceed), `window.open`/popups, `target=_blank`, and Google sign-in (Google blocks OAuth in embedded WebViews → offer Custom Tab fallback for accounts.google.com).
- **[NEW]** Crash-safe: WebView renderer-gone handler; `onRenderProcessGone` reload.
- **[NEW]** Free-tier watermark/ads must be non-removable in the generated project (injected at build by the worker from the plan flag, not from user-editable config).

### E. Build pipeline
- Status: `queued → building → signing → uploading → success | failed` (**[NEW]** `uploading`, plus `canceled`).
- **[FIX]** Idempotency: one active build per app; client-supplied idempotency key; credits/limits per plan (Free: e.g. 3 builds/day) to stop abuse and control compute cost.
- Worker steps: fetch job → render config + image pipeline (`sharp`) into a temp dir → start container with that dir mounted → Gradle (`assembleRelease` / `bundleRelease`) → sign → upload to R2 → update status.
- **[FIX]** Signing: Free/Starter use a **platform shared key**, held only in the worker host's secret store and mounted per build (not in code or image). Premium: per-app keystore via `keytool` with random passwords, stored AES-256-**GCM** (unique IV per record; master key from KMS/secret manager, with key-id field for rotation). Never log passwords.
- **[NEW]** Premium AAB: explain Play App Signing (user may upload their key as upload key); provide SHA-1/SHA-256 for Firebase, Google sign-in and assetlinks. Show keystore download once with strong warning + backup reminder email.
- New version of same app: reuse keystore + package, auto-increment `versionCode` atomically (`$inc` on app doc inside the build-create transaction), `versionName` editable.
- **[FIX]** Shell safety: user input only reaches files through a template renderer with escaping (XML-escape for strings.xml, Kotlin string escape, JSON for config). Gradle is invoked with a fixed argv array (no shell). User values never appear in `build.gradle` except validated applicationId / numeric versions.
- **[NEW]** Artifact retention: Free links expire after N days (R2 lifecycle rule + signed URL TTL); Premium retained while account active. Artifact checksum (SHA-256) stored and shown.
- **[NEW]** Post-build checks: `aapt2 dump badging` (package/version match), APK signature verify (`apksigner verify`), size sanity, optional emulator smoke test later.
- Retry: automatic retry only for infra errors (not for config errors); manual retry in UI; failure reasons mapped to friendly messages.
- **[NEW]** Log redaction (strip secrets, paths).

### F. User dashboard
- My Apps cards; app detail (edit, rebuild, history, downloads incl. keystore); live build page; orders/invoices; upgrade Free → Premium.
- **[NEW]** QR code to install the APK on a phone; "install from this link" page.
- **[NEW]** Domain-verification / assetlinks helper; "what to do next" checklist (test, publish to Play) with link to Play listing requirements.
- **[FIX]** Push panel (title, message, image, URL; to all or topic; history) — see below.

### G. Plans & payments
| Plan | Output | Push | AdMob | Branding / our ads | Own keystore | Play-ready |
|---|---|---|---|---|---|---|
| Free | APK | No | No | Yes | No | No |
| Starter | APK | Yes | Yes | Yes (watermark only, no our-ads) | No | No |
| Premium (one-time per app) | APK + AAB | Yes | Yes | Removed | Yes | Yes |

- Razorpay (INR) + Stripe (international); webhooks unlock plans.
- **[FIX]** Webhook rules: verify signatures, store raw event id (unique index) for idempotency, handle `payment failed / refunded / disputed` (refund → downgrade app, revoke Premium keystore *download*, not already-built artifacts), reconcile pending orders with a cron.
- **[NEW]** Price in minor units (integers) only; tax/GST/VAT handling and invoice numbering (India GST invoice requirements) — decide Stripe Tax / manual.
- Coupons: percent/flat, expiry, usage limit, **[NEW]** per-user limit, plan restriction, atomic redemption (`findOneAndUpdate` with `$inc` guarded by limit).
- Multi-currency display with admin-set prices per currency (no live FX at charge time).
- Manual add-ons (Play publishing help, keystore creation) as orders with a status the admin updates.

### H. Reseller program (Phase 3)
- Subscription (monthly/yearly) with unlimited builds while active; client list; reseller dashboard.
- 100% coupons for resellers → **[FIX]** replace with a proper `reseller` entitlement flag, not a coupon hack.
- API: `POST /api/v1/builds` with API key; **[NEW]** per-key rate limit and quota, scopes, key shown once and stored hashed (SHA-256 + prefix for lookup), **signed callbacks** (HMAC header, retries with backoff, replay window), idempotency key, OpenAPI doc.
- **[NEW]** Optional white-label for resellers (their branding on client pages) — later.

### I. Admin panel
Stats, users (block/role), apps, builds (retry/logs), plans/prices/coupons/showcase, orders/add-on requests, worker health (queue length, running builds, per-host load, orphan containers), site settings (our AdMob IDs and FCM).
- **[NEW]** Audit log of admin actions; moderation queue for reported/flagged apps; ability to disable an app and revoke download links (takedown).
- **[NEW]** Admin 2FA (TOTP).

### J. Email
Resend (recommended over Nodemailer/SMTP for deliverability): verify email, build result with link, receipt, reset, **[NEW]** keystore backup reminder, Premium expiry/reseller renewal notices. Templates in one place; SPF/DKIM set up.

### K. Security & platform
Helmet, CORS (single origin), rate limits, zod validation everywhere, upload validation (magic-byte check, size caps, re-encode images with sharp to strip payloads), schema check for `google-services.json`, encryption at rest, builds isolated in ephemeral Docker containers (one per build, non-root, resource-capped, removed after), SSRF protection.
- **[FIX]** SSRF: resolve DNS yourself, block private/loopback/link-local/metadata ranges (incl. IPv6 and `169.254.169.254`), **pin the resolved IP for the request** (prevents DNS rebinding), cap redirects and re-validate each hop, cap response size/time.
- **[NEW]** Secrets in a secret manager; no secrets in Mongo except encrypted blobs; `.env` not committed.
- **[NEW]** Structured logging + error tracking (Sentry), metrics (build duration, failure rate, queue depth), uptime alerts.
- **[NEW]** Backups: Atlas continuous backup; test restore. Keystore blobs backed up separately.
- **[NEW]** Privacy: data-processing terms, GDPR delete/export, cookie banner.

## Push notifications — gap fixed **[FIX]**
- `google-services.json` only configures the *client* app. Sending requires FCM HTTP v1 with a **service-account JSON** (or OneSignal REST API key) per app/project. Wizard step asks for both; store the credential encrypted; test-send button validates it.
- Alternative simpler default: platform-owned Firebase project for Starter/Premium users who don't want to set up Firebase (topic = appId). Decide which to ship first; recommend platform-owned for MVP-2, BYO as option.
- Topics, segmenting by app version, scheduled sends, delivery counts (FCM gives limited analytics) are later.
- Android 13+ runtime notification permission prompt timing configurable (not on first launch).

## Abuse & Play Store policy **[NEW]**
- Pure website wrappers can be rejected by Google Play ("minimum functionality / webview spam"). Surface this honestly in the UI and docs; suggest adding native value (push, offline page, bridge features).
- Prevent phishing/impersonation: ToS bans, block known bank/brand lookalikes on a denylist, URL ownership option (meta tag / DNS TXT) required before Premium or reseller builds, report-abuse link, takedown process.
- Block URLs on safe-browsing list (Google Safe Browsing API) at wizard and build time.
- Free-tier throttling (builds/day, IP + account), email verification, optional CAPTCHA.

## Data model (changes only)
Collections: users, apps, builds, keystores, orders, coupons, plans, notifications, resellerSubscriptions, apiKeys, showcase, settings.
- **[NEW]** `webhookEvents` (provider, eventId unique, payload hash, processedAt), `auditLogs`, `abuseReports`, `buildLogs` (separate collection or chunked to avoid 16 MB doc limit — **[FIX]** logs must not live in the build document), `pushCredentials` (encrypted, per app) or fold into `apps.push` encrypted fields.
- Indexes: `users.email` unique, `apps(owner,packageName)` unique, `builds(app,createdAt)`, `builds(status)`, `orders(user,createdAt)`, `webhookEvents.eventId` unique, TTL index on expiring artifacts metadata.
- `apps.versionCode` incremented atomically; `apps.configHash` to skip identical rebuilds.

## API (changes only)
Keep original groups. Add: `GET /api/builds/:id/events` (SSE), `POST /api/apps/:id/verify-domain`, `POST /api/url-check`, `POST /api/reports`, `GET /api/health`. Version public/reseller API under `/api/v1`. Uniform error shape `{code, message, fields?}`; pagination on lists.

## Phases
1. **Phase 1 (MVP, free APK builder, from zero):** scaffold repo; auth (email+Google, verify, reset); wizard (basic, branding, theme, core toggles, auto-prefill, SSRF-safe URL check, preview with fallback); Android template with hardening; builder Docker image + BullMQ worker → shared-key APK; `docker compose` for local dev (mongo, redis, server, worker, client); MyApps + build status (SSE) + download + QR; landing/pricing/legal; abuse basics (rate limits, Safe Browsing, takedown); CI building a sample app.
2. **Phase 2:** Premium (AAB, per-app keystore, white label); Razorpay + Stripe with idempotent webhooks; coupons; push (platform FCM first, BYO second); AdMob + consent; emails; admin panel + audit log.
3. **Phase 3:** reseller plans + API/callbacks; showcase; publishing-help add-on; multi-currency polish; domain-ownership verification.
4. **Later:** iOS (macOS builder + Xcode), in-app updates, analytics.

## Verification (expanded)
- **Template:** build by hand from sample config; install on `Medium_Phone_API_36.1` emulator and a real device; test each toggle (upload, download, deep link + assetlinks, offline screen, back/exit, pull-to-refresh, popups, Google sign-in fallback).
- **E2E:** sign up → create app → build → download APK → `adb install` → site loads. Automate with Playwright against a local stack (`docker compose`: mongo, redis, server, worker, client).
- **Signing/Play:** `apksigner verify`, `jarsigner -verify`, `bundletool validate`, upload AAB to Play Console internal testing; confirm update with same keystore + higher versionCode installs over old build.
- **Security tests:** SSRF suite (private IPs, redirects to metadata IP, DNS rebinding, IPv6, decimal/octal IPs); injection test with hostile app name (`"; rm -rf /`, XML/Kotlin metacharacters) → build still succeeds and output is escaped; upload bombs; webhook replay; coupon race (parallel redemptions).
- **Payments:** Razorpay/Stripe test mode; webhook unlocks Premium; duplicate/replayed webhook is a no-op; refund downgrades.
- **Push:** send from dashboard → arrives on device (foreground, background, killed).
- **Load:** 20 concurrent builds; confirm queue concurrency, timeout kill, no orphan containers, no cross-build file leakage, keystore tmpfs wiped, and no secret in build logs.
- **Container isolation:** from inside a build container, confirm no access to Redis/Mongo/API host, no Docker socket, and network egress blocked except allowed Maven hosts.
- **Automated:** Jest + Supertest (API), Vitest + RTL (client), template unit tests via Gradle `test` and a sample-app smoke build in CI.

## Risks (summary)
Play Store rejection of thin wrappers; abuse/phishing; build-host cost and capacity at scale (Gradle builds are CPU/RAM heavy: ~2 vCPU + 4 GB per concurrent build); container escape (keep Docker patched, consider gVisor/rootless later); loss of customer keystores; payment edge cases (refunds, tax); Google blocking OAuth in WebView; template targetSdk drift each year.

## Save location
This file, `WebToAppCOnverter/docs/PLAN.md`, is the saved plan.
