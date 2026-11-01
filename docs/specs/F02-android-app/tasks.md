# F02 Tasks

## Design
- One Gradle project with one `app` module, on Gradle 8.11.1, Android Gradle Plugin 8.7.3 and Kotlin 2.0.21. Versions are pinned in `gradle/libs.versions.toml`.
- `android-template/version.json` holds `minSdk`, `targetSdk`, `compileSdk`. Gradle reads it.
- Identity and signing come from Gradle properties: `applicationId`, `versionCode`, `versionName`, `appName`, `keystorePath`, `keystorePass`, `keyAlias`, `keyPass`.
- `app_config.json` is parsed into a typed `AppConfig` with `org.json`, so no extra library is needed.
- Cleartext is blocked in one manifest-level `network_security_config.xml`, so it can't be bypassed at runtime.
- Routing is a pure Kotlin classifier with no Android WebView dependency, so it can be unit tested without an emulator.

`app_config.json` fields added to `schemaVersion` 1:

```json
{
  "internalHosts": ["example.com"],
  "ui": {
    "statusBarColor": "#0F172A",
    "orientation": "unspecified",
    "zoom": false,
    "progressBar": true,
    "pullToRefresh": true,
    "exitDialog": true
  }
}
```

## Slices
- [x] T1: Extend the `shared` schema and add the sample config (R1, R6)
  - Tests first: AC1
- [x] T2: Gradle project, `version.json`, properties and signing (R2, R3, R4)
  - Proof: AC2, AC3
- [x] T3: Config parser and error screen (R1, R5)
  - Tests first: AC4
- [x] T4: Splash, WebView, status bar colour, orientation and hardening (R7, R10, R18, R20)
  - Proof: AC5, AC13, AC15
- [x] T5: URL classifier and routing, including schemes and popups (R12, R13, R16, R17)
  - Tests first: AC9. Proof: AC10
- [x] T6: Back, exit dialog, progress bar, pull-to-refresh and zoom (R8, R9)
  - Proof: AC6, AC7
- [x] T7: Offline screen, SSL errors and renderer recovery (R11, R19, R21)
  - Proof: AC8, AC14, AC16
- [x] T8: File upload and downloads (R14, R15)
  - Proof on the emulator first
- [x] T9: Test page on Cloudflare Pages and the full emulator pass (all)
  - Proof: AC5–AC10, AC13–AC17
- [x] T10: Real device pass (R14, R15, R17)
  - Proof: AC11, AC12
