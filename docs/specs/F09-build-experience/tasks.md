# F09 Tasks

## Design
- The build record helpers (`createBuild`, `enqueueBuild`, `setStatus`, the queue name and active statuses) move from `worker/src/builds.ts` into `shared/src/builds.ts`, a Node-only entry point `@sitetoapk/shared/builds`, so the server can queue builds.
- A build record gains `appId`, `ownerId`, `idempotencyKey`, `iconKey`, `versionName`, `failureKind` and `activeAppId`. `activeAppId` is set while a build is `queued` or active and removed when it ends. A unique sparse index on it allows one active build per app (R2). A unique index on `{ ownerId, idempotencyKey }` makes a repeated start return the same build.
- `server/src/builds/` holds the build routes, mounted under `/builds`, plus `POST /apps/:id/builds` and the latest-build field on `/apps`.
- Starting a build, in order: hold a short Redis lock per user, so parallel starts can't slip past the daily limit; check owner, `ready` and verified email; count the user's builds in the last 24 hours where `countsTowardLimit` isn't false; insert the build (the unique indexes refuse a second active build or return an idempotent repeat); `$inc` the app's `versionCode` and `buildCount`; copy the icon to `builds/<buildId>/icon.png`; queue it. A failure after the insert marks the build `failed` as infrastructure.
- `failureKind` is one of `input`, `compile`, `timeout`, `check` or `infra`. `infra` builds set `countsTowardLimit: false` (Q2).
- The worker downloads the icon copy into the build's temp folder, sets `lockedAt` on the app at the first success, and removes `activeAppId` at every end.
- `runContainer` gains an `onLine` callback. The worker redacts each line (the signing passwords, keystore path, temp folder, storage keys and environment values of that build, plus fixed patterns), then appends it to a Redis list `build:<id>:lines` capped at 2,000 and publishes it on `build:<id>`. Status changes are published on the same channel. At the end the lines go to `buildLogs`, keyed by build id, and the Redis list expires after an hour.
- `GET /builds/:id/events` sends the current status and the lines so far (from Redis while active, from `buildLogs` after), then relays the channel through one shared Redis subscriber, and ends after a final status.
- The server's icon store gains `copy` and `signedLink`, for icon copies and downloads, since icons and APKs share one private bucket.
- Install links: `POST /builds/:id/install-link` (owner) creates a 32-byte random token, stores its SHA-256 in `installTokens` with a TTL index, and returns `<APP_URL>/install/<token>`. The public routes `GET /builds/install/:token`, `/icon` and `/download` answer only for an unexpired token whose build still has its APK. Only `/download` is rate limited: one visit makes three requests, and a 256-bit token can't be guessed. Links point at `INSTALL_URL` when set, otherwise `APP_URL`.
- The client gets a build button and version field on Review, a build page at `/my-apps/:id/builds/:buildId` that follows the event stream, history and download on that page, the latest status on the apps list, and a public page at `/install/:token`. The QR code is drawn locally with the `qrcode` package.
- A phone can't reach `localhost`, so the real-phone proof runs the Vite dev server with `--host` and `APP_URL` set to the Mac's LAN address.

## Slices
- [x] T1: Shared build records and the start route (R1, R2, R3, R4, R5, R6, R16)
  - Tests first: AC1, AC2, AC3, AC4, AC11
- [x] T2: Worker: icon copy, failure kinds, active release and package lock (R5, R6, R10)
  - Tests first: AC5 (fake container), AC8
- [x] T3: Live logs: streaming, redaction, stored log and event stream (R7, R8, R9)
  - Tests first: AC6, AC7
- [x] T4: Build history and download (R11, R12)
  - Tests first: AC9
- [x] T5: Install links and the public install routes (R13, R14, R15)
  - Tests first: AC10 (link part)
- [x] T6: Client: build button, live build page, history, download, QR and install page
  - Component tests, then proof in a real browser
- [x] T7: Real proof: a full build through the website, download, and QR install on the phone (AC5, AC9, AC10)
