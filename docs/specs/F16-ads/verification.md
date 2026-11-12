# F16 Verification

| Criterion | Command or action | Real output or screenshot | Result |
|---|---|---|---|
| AC1 | `server/test/ads.test.ts` "AC1"; `worker/test/build.test.ts` "F16 AC1"; `worker/test/render.test.ts` "F16" | Free app: create and save refused 403 `ads_premium`, build start refused with nothing queued; the worker fails with an input error before the compile container; render refuses before writing | pass |
| AC2 | `shared/test/ads.test.ts`, `server/test/ads.test.ts` "AC2, AC3" | Premium draft keeps the settings and renders defaults; ads off leaves no `ads` in the config; the review page shows the Ads line | pass |
| AC3 | `shared/test/ads.test.ts` "AC3" | Malformed IDs, other publisher, no unit and a gap under 60 s are refused with the field named | pass |
| AC4 | `shared/test/ads.test.ts` "AC4", `client/test/ads-panel.test.tsx`, build page notice | Google test IDs spotted; the wizard and the build page say the app earns nothing | pass |
| AC5 | Owner's phone, Premium app built with Google test IDs | Banner at the chosen edge; interstitial after a page change, not on launch; gaps kept (unit tests for the gate in `AdsTest.kt`) | pass |
| AC6 | Owner's phone | Consent form shown before ads; "Ad privacy options" reopens it | pass |
| AC7 | Request flags in `Ads.kt` (`TAG_FOR_CHILD_DIRECTED_TREATMENT_TRUE`, under-age flag) from `childDirected`; `AdsTest.kt` parses the flag | Flag read and applied | pass |
| AC8 | `verify-image` on the server, image v5, and a local `aapt2` and dex check | Ads-off APK: no ad classes, no AD_ID, no AdMob entry. Ads APK: library, AdMob app ID, AD_ID present, +2.9 MB | pass |
| AC9 | Owner's phone, and the retry gate unit test | Page loads with ads failing; retries not sooner than 60 s | pass |
| AC10 | Privacy page, Premium card and the Play note on a Premium build | AdMob and advertising-ID wording present | pass |
| AC11 | `npm run verify-image -w worker -- sitetoapk-builder:v5` on the server | Three PASS lines: ads-off, Premium, Premium with ads; image holds no `.jks`, `.pass`, `.p12` or env file and no secret `ARG` or `ENV` in its history | pass |

Suites: shared 112, server 429, worker 137, client 82, Kotlin unit tests for both flavours.

Sign-off: owner, 2026-11-13
