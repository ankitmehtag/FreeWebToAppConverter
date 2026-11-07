# F12 Tasks

## Design
- `worker/scripts/verify-image.ts` checks the image's version label with `assertImageMatches`, then runs `processBuild` on the F02 sample config with the test key and a storage that keeps the APK in a temp folder, so the image goes through the same container, signing and `aapt2`/`apksigner` checks as a real build. It never touches R2 or Mongo beyond a throwaway collection.
- `worker/scripts/load-test.ts` queues 20 builds through `enqueueBuild`, each with package `com.loadtest.app<N>`, app name `Load <N>` and a marker host `marker-<N>.example` in `internalHosts`, plus one build with its own 30-second timeout run in its own process once the worker is taking jobs. It starts the worker itself, kills it with SIGKILL after 4 successes and starts it again. It samples `docker ps` every 2 seconds for build containers, waits for every build to end, then checks the work root, containers, Redis log lists, each APK's `app_config.json` (downloaded through a signed link and read with `unzip`), and every stored log and record for the test secrets.
- Found by the load test: a killed worker's containers ran on while the new worker started 2 more, and 4 builds at once ran Docker out of memory. A starting worker now removes every build container before it takes jobs, and a build that runs out of memory fails as `infra`, so it is retried and not counted against the user.
- `client/e2e/journey.mjs` is a Playwright script, run with `npm run journey -w client`. It drives the built site like F09's browser proof, then installs the APK with `adb`, launches it with `am start`, and reads `uiautomator dump` until the page shows "Example Domain". Every step is named; a failure saves a screenshot or the UI dump under `client/e2e/out/`.
- Production: `deploy/compose.prod.yml` adds Caddy and the worker image's settings to the services, with the API on the internal network only; `deploy/Caddyfile` serves `client/dist` with `try_files {path} {path}.html /app.html` and reverse-proxies the API paths. `TRUST_PROXY` names Caddy's network. `deploy/README.md` is the deploy guide.
- `docs/PHASE1.md` is the Phase 1 summary.

## Slices
- [x] T1: Builder image check (R11)
  - Proof: AC9
- [x] T2: Production setup and deploy guide (R12, R13, R14)
  - Proof: AC10, AC11 (guide part)
- [x] T3: Load test (R4, R5, R6, R7, R8, R9, R10)
  - Proof: AC3, AC4, AC5, AC6, AC7, AC8
- [x] T4: End-to-end journey on the emulator (R1, R2, R3)
  - Proof: AC1, AC2
- [x] T5: Phase 1 summary and sign-off (R15)
  - Proof: AC11
