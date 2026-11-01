# F02 Android app

Status: approved

## Goal
A Kotlin WebView app in `android-template/` that turns one `app_config.json` and a set of Gradle properties into a working, hardened Android app, built by hand on a dev machine. This proves the riskiest part of the product before any build infrastructure exists.

## Out of scope
- Rendering files from user input, the icon pipeline and the watermark (F03). F02 uses hand-written sample values and a placeholder icon.
- The builder image, queue and production signing (F04).
- Push, AdMob and consent (F15, F16). These are later flavours, so F02 must add none of their code, libraries or permissions.
- AAB output (F13) and App Links verification (F19).
- Bottom navigation, swipe navigation and custom error pages.
- The JS bridge `window.AppBridge`, until a feature needs it (F15 push).

## Requirements

### Config and build
- R1: The app must read all runtime settings from `assets/app_config.json`, and the sample must pass the `shared` zod schema.
- R2: `applicationId`, `versionCode`, `versionName` and the app label must come only from Gradle properties, not from source edits or `app_config.json`. The app ignores `packageName` and `appName` in `app_config.json`, which stay in the schema as worker input for F03 and F04.
- R3: `minSdk` (24), `targetSdk` (35) and `compileSdk` must come from `android-template/version.json`.
- R4: `assembleRelease` with keystore details passed as Gradle properties must produce an APK signed with that key. No keystore is stored in the repo.
- R5: If `app_config.json` is missing or invalid, the app must show a fixed error screen and not crash.
- R6: `shared` must add `internalHosts` and the behaviour toggles to the schema, staying at `schemaVersion` 1 because no app has shipped yet.

### Navigation and UI
- R7: The app must show a splash using the AndroidX SplashScreen API, then load `startUrl`.
- R8: Back must go back through WebView history. When there is no history, it must show the exit dialog if enabled, and otherwise close the app.
- R9: Toggles `progressBar`, `pullToRefresh`, `exitDialog` and `zoom` must each change behaviour when on and off.
- R10: `statusBarColor` and `orientation` must be applied from config.
- R11: When a page can't load because the device is offline, the app must show a bundled offline screen with a retry button.

### Links, files and popups
- R12: Links to hosts in `internalHosts` must open in the WebView, and all other web links in the external browser.
- R13: `tel:`, `mailto:`, `market:` and `intent://` links must be handed to Android. `intent://` must have its component and selector removed, and may only fall back to an HTTPS `browser_fallback_url`.
- R14: A page's file upload must open the system picker with no broad storage permission.
- R15: A page's download must go through `DownloadManager`.
- R16: `window.open` and `target=_blank` must follow the same routing as R12.
- R17: Navigation to `accounts.google.com` must open in a Custom Tab, not the WebView.

### Security
- R18: WebView file access and content access must be off, Safe Browsing on, and `file:` and `javascript:` navigation from web content blocked.
- R19: An SSL error must cancel the load and show an error, never proceed.
- R20: Cleartext HTTP traffic must be blocked in all apps, matching the HTTPS-only `startUrl` rule from F01.
- R21: If the WebView renderer dies, the app must recreate the WebView and reload, not crash.

## Acceptance criteria
- AC1 (R1, R6): Given the sample config, when validated by the `shared` tests, then it is accepted, and a bad `internalHosts`, colour or orientation value is rejected.
- AC2 (R2, R3): Given a build with chosen properties, when `aapt2 dump badging` runs on the APK, then it shows that package, version, label, `minSdk` 24 and `targetSdk` 35.
- AC3 (R4): Given a test keystore outside the repo, when `apksigner verify --print-certs` runs, then the APK verifies with that certificate, and `git status` shows no keystore.
- AC4 (R5): Given a missing, malformed or wrong-version config, when the app starts, then the error screen appears and no crash is logged.
- AC5 (R7): Given a valid config, when the app starts on `Medium_Phone_API_36.1`, then the splash shows and then `startUrl` loads.
- AC6 (R8): Given two pages visited, when back is pressed, then history unwinds, and the next back shows the exit dialog if enabled and closes the app if not.
- AC7 (R9, R10): Given each toggle and setting, when the app is built on and off, then the behaviour matches each state, recorded per toggle.
- AC8 (R11): Given airplane mode, when a page load fails, then the offline screen shows, and retry loads the page after reconnecting.
- AC9 (R12, R13, R16, R18): Given the URL classifier's unit tests, when run, then internal, external, `tel:`, `mailto:`, `market:`, `intent://` with a component, `javascript:` and `file:` cases all route correctly.
- AC10 (R12, R13, R16): Given the test page, when each link type is tapped on the emulator, then it opens in the expected place.
- AC11 (R14, R15): Given the test page on a **real device**, when an image is uploaded and a PDF downloaded, then both succeed, and `aapt2 dump permissions` shows no storage permission.
- AC12 (R17): Given a Google sign-in link on a **real device**, when tapped, then it opens in a Custom Tab and sign-in completes.
- AC13 (R18): Given a page attempting `file://` navigation, when it runs, then the file does not load.
- AC14 (R19): Given `https://expired.badssl.com`, when loaded, then it stays blocked and an error shows.
- AC15 (R20): Given an `http://` link to an internal host, when followed, then no cleartext request is made.
- AC16 (R21): Given a debug build, when the renderer is killed, then the app recovers and reloads.
- AC17 (R1–R21): Given a release build, when `aapt2 dump permissions` runs, then it lists only expected permissions, with nothing from push or ads.

## Decisions
- Standard emulator: `Medium_Phone_API_36.1`, replacing `Pixel_5_API_36`.
- Real device: available. Everything else is tested on the emulator first. AC11 and AC12 run on the real device at the end, and F02 can't be signed off until they pass.
- Test page: a small static page on Cloudflare Pages.
- The JS bridge is left out of F02.
- The app ignores `packageName` and `appName` in `app_config.json`.
- F03 R3 replaces the app label part of R2: the label now comes from a generated resource, not a Gradle property.

## Open questions
None.
