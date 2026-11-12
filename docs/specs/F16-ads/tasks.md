# F16 Tasks

## Design
- One switch decides everything: `ads` is present in `app_config` only when the owner turned ads on (R8, R9). Off leaves no trace in the config.
- Ads are a Premium feature in three places: the server on save and on build start, the worker before compiling, and `render` before writing anything (R1).
- The template has two Gradle flavours, `noads` and `ads`. Only `ads` has the AdMob and consent libraries, the manifest entries and the real `Ads.kt`; `noads` has a no-op `Ads.kt`. `builder/build.sh` picks the flavour from `-PadsEnabled=true`, which `render` passes with `-PadsAppId=...` (shape-checked first).
- Pure logic (`InterstitialGate`, `RetryGate`, `AdsConfig`) sits in `main`, so unit tests cover it without the ad library.
- Consent is Google's UMP: ask first, load nothing until `canRequestAds()`, offer "Ad privacy options" when Google says it is required.

## Slices
- [x] T1: Config schema, draft, permissions (R2, R3, R9)
  - Tests first: AC2, AC3, AC4 (shared)
- [x] T2: Premium-only in server, worker and render (R1)
  - Tests first: AC1 (server, worker)
- [x] T3: Template: flavours, ad code, consent, gates, unit tests (R5, R6, R7, R8, R12)
  - Tests first: AC7 flags, gap and retry rules (Kotlin)
- [x] T4: Builder script and verify-image checks for ads-off and ads-on (R8, R11)
  - Proof: AC8, AC11
- [x] T5: Wizard step, review and build page notes, pricing, privacy and Play wording (R2, R4, R9, R10)
  - Tests first: AC4, AC10 (client)
- [x] T6: Image v5 built and verified on the server, deployed; owner phone check with test IDs pending (AC5, AC6, AC9)
