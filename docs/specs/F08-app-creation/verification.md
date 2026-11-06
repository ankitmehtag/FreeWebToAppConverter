# F08 Verification

Run on 2026-11-06. Automated tests used Mongo, Redis and SeaweedFS from Compose. Browser rows ran in headless Chromium (Playwright) against the Compose API and the Vite dev server, with mail sent to Mailpit.

Status: all criteria pass. Waiting for the owner's sign-off.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | Browser: signed up, opened the verify link from Mailpit, opened `/my-apps` signed out, signed in, signed out, signed in again | "Check your email", then "Email confirmed"; signed-out `/my-apps` went to `/sign-in?next=%2Fmy-apps` and came back after sign-in; second sign-in listed 2 apps; 0 page errors | pass |
| AC2 | `npm test -w client`; `npm test -w server` | Client copies `csrf_token` into `x-csrf-token` on POST, PUT and DELETE only; API answers 403 to create, update, delete, upload and prefill without it | pass |
| AC3 | `npm test -w server` (apps) | Another user's read, update and delete answer 404, the app is unchanged; malformed id 404; list holds only the caller's apps | pass |
| AC4 | `npm test -w server` (apps, icons) | URL-only draft reloads unchanged, `ready: false`; full draft plus icon is `ready: true` and passes the `shared` schema | pass |
| AC5 | `npm test -w server` (apps) | Deleting a never-built app answers 204; with a recorded build 409 and the app remains | pass |
| AC6 | `npm test -w server` (apps) | Same package name for one user 409 on create and update; two users may share one; after a recorded build, renaming 409 with "can’t change after the first build", other fields save | pass |
| AC7 | `npm test -w server` (apps) | 20 creates 201, the 21st 409 | pass |
| AC8 | `npm test -w client`; browser: changed zoom, pull to refresh and orientation on Behaviour, waited for "All changes saved", reloaded | Back on `/behaviour` with zoom on, pull to refresh off, orientation `portrait`; a value the rules refuse is not saved and shows "Fix the highlighted fields to save" | pass |
| AC9 | `npm test -w shared`; `npm test -w server` | Control characters, bad and reserved package names, bad colour, HTTP URL and extra fields each answer 400 with that field named; a hostile name is stored as plain text | pass |
| AC10 | `npm test -w client`; browser with `http://info.cern.ch` | "Doesn’t use HTTPS", Next and later steps disabled, nothing saved; unreachable site shows "We couldn’t reach that site" | pass |
| AC11 | `npm test -w server` (prefill) | Manifest site offers `Shop`, `#00FF66` and the 512 icon in exactly 3 fetches; 32×32 favicon offers no icon; a lying size offers no icon; manifest on `10.0.0.5` and icon on `169.254.169.254` are never fetched | pass |
| AC12 | `npm test -w shared`; `npm test -w server` (icons) | Renamed JPEG "not a PNG", 256×256 "at least 512", non-square "square", 6 MB file 413 "5 MB"; a valid icon is stored re-encoded without its trailing data | pass |
| AC13 | `npm test -w server` (icons) | Owner gets the icon with `Cache-Control: private, no-store`; another user 404; signed out 401; the bucket object without credentials 403 | pass |
| AC14 | Rendered the browser proof's "Proof Shop" record with `toAppConfig`, built it with `build-app` on R2 and the test key, then ran `aapt2 dump permissions` and `apksigner` | Review showed `INTERNET`; the APK `com.example.app`, label `Proof Shop`, uses `android.permission.INTERNET` plus its own `com.example.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, and nothing else; SHA-256 `26810adb…1fae53` matches the record; signer `c546406a…a024e8` | pass |
| AC15 | `npm test -w client`; browser with `https://example.com` and `https://github.com` | example.com shown live in a sandboxed iframe; github.com shows the blocked notice and no iframe | pass |

Automated totals: `shared` 69 of 69, `server` 193 of 193, `client` 19 of 19, typecheck 0 errors, client build passes. At phone width (390 px) the wizard has no horizontal scroll.

## Known limits
- AC14 compares everything except the app's own AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which users never see.
- The live preview frames the site from our page. A site can still change what it serves to frames, so the preview is a guide and not the app.
- `/url/check` allows 10 checks per 15 minutes per IP. The wizard spends one per check and one after a refresh when the tab has no saved result.
- Worker tests still create a bucket per test, which fills SeaweedFS over many runs. Server tests share one bucket.
