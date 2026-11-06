# F09 Build experience

Status: approved

## Goal
Let a user turn a ready app into a signed APK from the website: start a build, watch it happen, download the APK from their apps page, and install it on a phone by scanning a QR code. F04 and F05 already build, sign, store and link an APK from a script. F09 puts that behind the account, with the limits that keep build costs and abuse in check, so that by the end a stranger can go from sign-up to an installed app.

## Out of scope
- Premium builds, AAB output and per-app keystores (F13). Every F09 build is a Free APK signed with the shared key.
- Safe Browsing and the brand denylist (F10). F09 builds any ready app; F10 adds the block before a build starts.
- Email when a build finishes (F18).
- Cancelling a build, and admin retry or log access (F17).
- Push, ads and anything else that changes what goes into the APK.

## Requirements

### Starting a build
- R1: `POST /apps/:id/builds` must start a build only for the app's owner, only when the app is `ready`, and only when the owner's email is verified. Otherwise it must refuse with the reason.
- R2: An app must have at most one active build (`queued`, `building`, `signing` or `uploading`). A start request carries an idempotency key, and a repeat with the same key returns the same build.
- R3: Each build must get the app's next `versionCode` with an atomic increment, so that parallel starts never share one. The user may set a `versionName`.
- R4: A Free user may start at most 3 builds in any 24 hours. Builds that fail because of our infrastructure do not count.
- R5: A build must use a copy of the app's config and icon taken when it starts, so later edits can't change a running build.
- R6: Starting a build must add 1 to the app's `buildCount`, and its first success must set `lockedAt`, which F08 already uses to lock the package name.

### Live progress
- R7: `GET /builds/:id/events` must stream the build's status changes and log lines to its owner with Server-Sent Events, and send everything so far to a viewer who joins late.
- R8: The worker must publish container output line by line through Redis as it arrives. When the build ends, the log must be kept in a `buildLogs` collection, not in the build record, capped at the last 2,000 lines.
- R9: No signing password, keystore path, storage key, host path or environment value may appear in a live or stored log.
- R10: A failed build must show a plain reason the user can act on: the site config was refused, the build timed out, the APK failed its checks, or our side failed and they can try again.

### Apps page and download
- R11: The apps page and each app must show the latest build's status, and the app must list its last 10 builds with version, date, status, size and SHA-256.
- R12: `GET /builds/:id/download` must answer only the owner, with a redirect to a signed link that lasts 1 hour. An expired Free build (after 7 days, F05) must say it has expired and offer a new build.

### Install on a phone
- R13: A successful build's page must show a QR code for an install page that works on a phone without signing in.
- R14: The install link must hold a random token, stored only as a hash, that lasts 1 hour and opens only that build. It must stop working when the build's APK is deleted.
- R15: The install page must show the app's name, icon, version and size, a download button, and short steps for allowing an app from outside Google Play.

### Hardening
- R16: Every build route must use zod validation, the session and CSRF checks from F06, and a per-user rate limit.

## Acceptance criteria
- AC1 (R1): Given another user's app, an app that isn't ready, or an unverified owner, when a build is started, then each is refused with its reason and nothing is queued.
- AC2 (R2): Given a double click, and 10 parallel starts with one idempotency key, then one build exists. Given an active build, then a second start is refused.
- AC3 (R3): Given 20 parallel calls to the `versionCode` increment of one app, and builds of one app one after another, then no two builds of an app share a `versionCode`, and the codes have no gaps.
- AC4 (R4): Given 3 builds in 24 hours, then the 4th is refused with when the next one is allowed. Given a build failed by our infrastructure, then it doesn't count.
- AC5 (R5, R6): Given a running build, when the app's name and icon are changed, then the APK has the old ones. After its success the package name is locked.
- AC6 (R7, R8): Given a running build, when its page is open, then status changes and log lines appear as they happen. A viewer who joins late sees the earlier lines first. Another user gets 404.
- AC7 (R9): Given a build with known test secrets, when its live stream and stored log are searched, then none of them appear.
- AC8 (R10): Given each kind of failure, then the page shows its plain reason, and an infrastructure failure offers to try again.
- AC9 (R11, R12): Given a successful build, when downloaded from the apps page, then the file matches its SHA-256. Another user gets 404. An expired build says so and offers a new build.
- AC10 (R13, R14, R15): Given a successful build, when its QR code is scanned on a real phone, then the install page opens without signing in, and the APK installs and opens the site. After 1 hour, or once the APK is deleted, the link fails.
- AC11 (R16): Given rapid starts, extra fields or a missing CSRF token, then each is refused.

## Decisions
- One active build per app is enforced by a unique index on a field that only active builds carry, so it holds across parallel requests and worker restarts.
- The icon copy lives in R2 next to the build (`builds/<buildId>/icon.png`), and the worker downloads it into the build's temp folder.
- Logs are redacted in the worker before they leave it, using the build's own secret values as well as fixed patterns.
- The QR code is drawn in the browser, so the install link never passes through a third-party service.
- The real-phone check in AC10 runs on the same moto g35 5G used in F02 and F05.

## Open questions
- Q1: What should `versionName` be? Proposed: the user may type one such as `1.2`, digits and dots only, and by default it repeats the last build's.
- Q2: Which builds count toward the 3 per day? Proposed: every build except those failed by our infrastructure, because a failed compile still uses a build host.
- Q3: Is a 1-hour install link that needs no sign-in acceptable? Anyone holding the link can download that APK for the hour, as with the F05 signed links. Proposed: yes.
- Q4: Is the 24-hour window rolling, or a calendar day? Proposed: rolling, so it never resets at midnight for one time zone and not another.
