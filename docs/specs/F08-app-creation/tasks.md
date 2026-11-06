# F08 Tasks

## Design
- `server/src/apps/` holds the app routes, mounted under `/apps` when auth and storage are passed. They reuse `allowOrigin`, `requireSession`, `requireCsrf`, `limitRoute` and the shared error handler. `allowOrigin` adds `PUT` and `DELETE` to its allowed methods.
- `PUT /apps/:id` takes the whole draft, so that a field can be cleared by leaving it out. Field errors come back as `{ error, fields: { 'ui.statusBarColor': message } }`.
- An app document is `{ _id, ownerId, draft, iconKey?, ready, buildCount, lockedAt?, createdAt, updatedAt }`. `draft` holds the `app_config` fields, each optional. `ready` is worked out on every save by rendering `draft` into an `AppConfig` and checking it with the `shared` schema, plus an icon being present.
- Every query uses `{ _id, ownerId }`. An id that isn't a valid ObjectId answers 404, the same as a missing app.
- A unique partial index on `{ ownerId, 'draft.packageName' }` enforces R7 across concurrent saves. The lock is a filter on the update (`lockedAt` absent, or the package name unchanged), so a race can't slip past it.
- The 20-app limit is checked by counting before insert. Two parallel creates can reach 21 at most, which is accepted for a storage limit.
- `shared/` gets `draftSchema` (every `app_config` field optional, same rules), `toAppConfig(draft)`, `suggestPackageName(host)` and `permissionsFor(config)`, so the client and server use one copy. `toAppConfig` fills untouched behaviour with defaults and `internalHosts` with the start URL's host. The colour has no default, so Branding must set it.
- `shared`'s main entry stays safe for the browser. The icon checks and the S3 client are the separate entry points `@sitetoapk/shared/icon` and `@sitetoapk/shared/s3`.
- `permissionsFor` lists what the Review step shows. The APK also defines its own `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` from AndroidX, which is internal and never shown to users, so AC14 compares everything except that one.
- The icon checks move from `worker/src/icon.ts` into `shared/src/icon.ts` as `checkIcon(buffer)`, and `readIcon(path)` in the worker calls it. `shared` gains `sharp` as a dependency.
- The R2 client setup moves into `shared/src/s3.ts`. The worker's artifact storage and the server's icon storage each build on it with their own commands.
- Icons are stored at `icons/<appId>.png`. `POST /apps/:id/icon` takes a raw `image/png` body up to 5 MB, and `GET /apps/:id/icon` streams it to the owner with `Cache-Control: private, no-store`.
- `POST /apps/prefill` takes a URL and makes at most 3 fetches: the page, its manifest and one icon. It returns the offered name, colour and icon, the icon as a `data:` URL. Accepting the icon uploads those bytes through the normal icon route, so it passes the same checks. It needs a session, and is limited like `/url/check`.
- `client/` is a Vite + React + React Router app. The Vite dev server proxies `/auth`, `/apps` and `/url` to the API, so the app and the API share one origin and its cookies, and the refresh cookie's `/auth` path still matches. Production must serve both from one origin the same way. Every call goes through one `api()` helper that sends cookies, adds `x-csrf-token` from the `csrf_token` cookie, and tries `/auth/refresh` once on a 401.
- Because `/apps` belongs to the API, the client's pages live under `/my-apps`: the list at `/my-apps` and the wizard at `/my-apps/:id/:step`.
- Browser proofs run in headless Chromium through Playwright, a `client` dev dependency that F12's end-to-end tests will also use.
- The wizard keeps one draft in memory, saves the draft with `PUT` 600 ms after the last edit and when moving on, and stores the step in the URL so a refresh returns to it.

## Slices
- [x] T1: Shared rules: icon checks, storage, draft schema, package suggestion, permissions (R11, R13, R16, R18)
  - Tests first: AC12 (unit), AC9 (schema part)
- [x] T2: App records API (R4, R5, R6, R7, R8, R11)
  - Tests first: AC3, AC4, AC5, AC6, AC7, AC9
- [x] T3: Icon upload and private storage (R16, R17)
  - Tests first: AC12, AC13
- [x] T4: Site prefill (R14, R15)
  - Tests first: AC11
- [x] T5: Client scaffold and account pages (R1, R2, R3)
  - Tests first: AC2; proof AC1 in a real browser
- [x] T6: Wizard, URL check, autosave, preview and Review (R9, R10, R12, R13, R18, R19)
  - Tests first: AC8, AC10, AC15 (component tests), then proof in a real browser
- [ ] T7: Permission proof on a built APK (R18)
  - Proof: AC14
