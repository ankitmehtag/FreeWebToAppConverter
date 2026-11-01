# F02 Verification

Run on 2026-11-01 on `Medium_Phone_API_36.1` (API 36) and a moto g35 5G (Android 15, API 35). Test page: `https://sitetoapk-test.pages.dev/`. Results marked "owner" were done by hand on the phone and reported by the owner.

Status: all criteria pass, signed off by the owner on 2026-11-01.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w shared` | Sample accepted; bad `internalHosts`, colour and orientation rejected; 38 of 38 passed | pass |
| AC2 | `aapt2 dump badging` on the release APK | `com.sitetoapk.sample`, version 1 / 1.0, label `Sample App`, `minSdkVersion:'24'`, `targetSdkVersion:'35'` | pass |
| AC3 | `apksigner verify --print-certs`; `keytool -list`; `git status` | Signer SHA-256 `c546406a…a024e8` matches the test key at `~/.sitetoapk/test.jks`; no keystore in `git status` | pass |
| AC4 | Built with the config missing, malformed and at `schemaVersion` 2, then started the app | Error screen each time; 0 crash entries, 0 `FATAL EXCEPTION` | pass |
| AC5 | Started the app on the emulator and the phone | After the fix below, timed captures on the emulator show the navy splash with icon for about 3 seconds, then `F02 home`. On the phone the splash showed, then `F02 home` (owner) | pass |
| AC6 | Tapped `Internal page`, then back twice; repeated at root with `exitDialog` off | `F02 page two`, back to `F02 home`, then `Exit the app?`; with the dialog off, back closed the app | pass |
| AC7 | Built each setting both ways | See the table below | pass |
| AC8 | Airplane mode on, cold start, airplane mode off, tapped Retry, on a clean release build | Offline screen, then the page loaded | pass |
| AC9 | `scripts/build-sample.sh testDebugUnitTest` | `UrlRouterTest` 9 of 9, `AppConfigTest` 5 of 5 | pass |
| AC10 | Tapped each link on the test page and read the top activity | External, `target=_blank` and popup: Chrome. `tel:`: Dialer. `mailto:`: Gmail. `market:`: Play Store. `intent://` with a component: Chrome, not Settings. Internal and blank internal: stayed in the app on `F02 page two` | pass |
| AC11 | On the phone, picked a pushed test image, tapped `Download PDF`, ran `aapt2 dump permissions` | System photo picker; page showed `uploaded … 118538`, the file's real size; `sample.pdf` 310 bytes in Downloads with `Download complete`; 0 storage permissions | pass |
| AC12 | On the phone, tapped `Google sign-in` | Top activity `CustomTabActivity`; sign-in completed (owner) | pass |
| AC13 | Tapped `File link` and `File script` | Same `loaded:` stamp, still on `F02 home` | pass |
| AC14 | Built with `startUrl` `https://expired.badssl.com/` | SSL error message shown with Retry; page never loaded | pass |
| AC15 | Tapped `Cleartext internal` | Same `loaded:` stamp, still on `F02 home`. Shown by behaviour and the `BLOCK` route; network traffic was not captured | pass |
| AC16 | Debug build with a temporary `chrome://crash` load, since removed | Logcat `Renderer process (8753) crash detected`; page reloaded; 0 crash entries | pass |
| AC17 | `aapt2 dump permissions` on the release APK | `INTERNET` and the AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; nothing from push or ads | pass |

## AC7 by setting

| Setting | On or first value | Off or second value |
|---|---|---|
| `progressBar` | Bar seen during a throttled load | Not seen |
| `pullToRefresh` | Swipe reloaded the page, new `loaded:` stamp | Swipe left the same stamp |
| `exitDialog` | Dialog shown | App closed |
| `zoom` | Pinch zoomed on the phone (owner) | Pinch did nothing on the phone (owner) |
| `statusBarColor` | `#0F172A` shown | `#B91C1C` shown |
| `orientation` | `portrait` stayed at rotation 0 with the device turned | `landscape` gave rotation 1; `unspecified` followed the device |

## Final build rerun on the phone
Run after sign-off on the merged code, on the moto g35 5G, with no app crashes logged.

| Check | Result |
|---|---|
| Cleartext and `file:` links stay on the page | pass |
| External, `target=_blank`, popup and intent links open Chrome | pass |
| `mailto:` opens Gmail compose | pass |
| `tel:` and `market:` reach the Android chooser | pass, no choice made in the chooser |
| Google link opens `CustomTabActivity` | pass |
| Internal page, back, exit dialog; blank internal | pass |
| Exit dialog off closes the app | pass |
| Pull-to-refresh on and off | pass |
| Download and upload | pass |
| SSL block and config error screen | pass |
| Landscape | pass, display 2400x1080 |
| Renderer crash recovery | pass, logged crash then `F02 home` |
| Offline screen and retry | not proven on the phone: the page still loaded in airplane mode, and the rerun with all networks off lost USB. Passed on the emulator on the final code |

## Fixed during verification
- AC16 first failed: the app survived a renderer death but stayed blank, because `SwipeRefreshLayout` keeps its first child for good. The WebView now sits in a permanent `web_container`, and pull-to-refresh was retested.

- AC5 first failed: the splash was not visible on the phone, because it ended on the first frame. It now stays until the first page finishes or an error shows, for 3 seconds at most. The offline screen (AC8) and error screen (AC4) were retested and are not held back by it.

## Known limits
- Deploying with wrangler 4.156.0 needs `--force` on `pages project create` once, because Pages commands now delegate to Workers.
- The test page lives on the `ankit.mehta@programming.com` Cloudflare account.
- Downloads before Android 10 go to app-specific storage, and were not tested. The lowest API tested is 35, against `minSdk` 24.
