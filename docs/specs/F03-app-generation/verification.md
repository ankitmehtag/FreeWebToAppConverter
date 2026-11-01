# F03 Verification

Run on 2026-11-01 on `Medium_Phone_API_36.1`. Apps were rendered by `render` and built with its `gradleArgs`.

Status: all criteria pass, signed off by the owner on 2026-11-01.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w worker` | Two folders, same files | pass |
| AC2 | `npm test -w worker` | Bad config, version, plan and icon rejected, no folder left | pass |
| AC3 | Built 12 names, read each from the App info screen | `"; rm -rf /`, `</string><evil/>`, `@string/x`, `?attr/y`, `%1$s`, `A`, `say "hi"`, `it's`, `🚀 App`, `تطبيق`, `two  spaces` and `Tom & Jerry` all shown literally | pass |
| AC4 | `npm test -w worker` | Hostile values round-trip, no extra field | pass |
| AC5 | `npm test -w worker` | No Gradle or Kotlin file written; name absent from `gradleArgs` | pass |
| AC6 | Built `#B91C1C` and `#15803D`, captured the splash | Each splash shows its colour | pass |
| AC7 | `npm test -w worker` | JPEG, HTML, truncated, 511×511, non-square, over 5 MB and bomb each rejected with a reason | pass |
| AC8 | `npm test -w worker` | Metadata and trailing data absent from the output | pass |
| AC9 | Built opaque and transparent icons, read App info | Both shown on a round mask with nothing clipped; white behind opaque, app colour behind transparent. Launcher and themed mode checked on the phone (owner) | pass |
| AC10 | Free and Premium builds | Label at `[0,2274][1080,2337]` on Free; absent on Premium | pass |
| AC11 | `npm test -w shared`; added watermark fields to a rendered config and built | Schema rejects them; label still shown | pass |
| AC12 | Free build on the page, offline, SSL and config error screens | Label on all four; WebView ends at 2274, where the label starts, so no overlap; links still tap | pass |
| AC13 | F02 checks on a generated app | Routing, blocked links, back, exit, pull-to-refresh, upload, download, offline, SSL and renderer recovery pass; 0 crashes. Upload, download and sign-in also pass on the phone | pass |

Automated totals: `shared` 42 of 42, `server` 5 of 5, `worker` 38 of 38, typecheck 0 errors.

## Real device
On a moto g35 5G (Android 15), with a generated Free app:
- Watermark shown on the page.
- Upload through the system picker: page showed 30759 bytes, the test file's real size.
- `sample.pdf` downloaded, 310 bytes.
- Google link opened `CustomTabActivity`, and back returned to the app.
- 0 app crashes.

Reported done by the owner: launcher icon, themed icon and completing Google sign-in.

## Server image
`docker compose build api` built on Docker 29.9.2 with the new workspace. `src/app.ts` loads in the image, and `sharp` is not installed there.

## Fixed during verification
- AC9 first failed: an opaque square logo lost its corners, because a 66dp square was used where the safe zone is a 66dp circle. The artwork now fits inside the circle.

## Known limits
- A square logo now fills about 43% of the icon canvas, because its corners must stay inside the circle.
- An opaque white logo gives an empty themed icon, because that layer takes its shape from the dark parts.
