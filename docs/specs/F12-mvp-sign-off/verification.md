# F12 Verification

Run on 2026-11-07 on the Mac (8 CPUs, 16 GB; Docker with 7.7 GB). The API, Mongo, Redis and Mailpit ran in Compose with mail sent to Mailpit; the worker ran on the host with the test signing key and `sitetoapk-builder:dev`; APKs went to R2. The journey drove the built site (`vite preview` on `localhost:5173`) in headless Chromium and the `Medium_Phone_API_36.1` emulator through `adb`.

Status: all criteria pass, signed off by the owner on 2026-11-07.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm run journey -w client` | Every step passed: sign up, confirm email from Mailpit, sign in, create `com.example.journey1794005047242`, icon and colour, start build, follow build (78 log lines, 356 s), download with SHA-256 matching the page (`ece651d2cbdb…`), install, open, "documentation examples" shown by the app in 18 s, uninstall | pass |
| AC2 | Worker stopped; `JOURNEY_BUILD_WAIT_MS=60000 npm run journey -w client` | Passed up to "start build", then `FAIL follow build: locator.waitFor: Timeout 60000ms exceeded`, with the page saved to `client/e2e/out/follow-build.png` showing "Waiting for a build server…" | pass |
| AC3 | `LOAD_BUILDS=20 BUILD_CONCURRENCY=2 npm run load-test -w worker` | Peak 2 build containers at once (2 at most in the 90 s after the kill, counting the dead worker's leftovers); `{"success":20}` in 56.6 minutes | pass |
| AC4 | Same run | 0 build containers left, 0 entries in the work root, every live log list expiring within an hour (TTLs 568 to 3592 s) | pass |
| AC5 | Same run | 20 of 20 APKs, each `assets/app_config.json` read with `unzip`, hold only their own package name, app name and marker | pass |
| AC6 | Same run | 9 secrets searched in 1653 live lines, 111231 bytes of stored logs and 21 records: none found | pass |
| AC7 | `LOAD_BUILDS=6 npm run load-test -w worker` (after the fix below); the 20-build run for the kill | 30-second build: `failed, timeout, Build timed out`. Worker killed with SIGKILL after 4 successes and started again: "Removed 2 build container(s) left by a previous worker", 2 builds ran again, 0 stuck, `{"success":6}` | pass |
| AC8 | Both runs | 20 builds: median 5.7 min, slowest 6.2 min, longest queue wait 51.3 min. 6 builds: median 5.4, slowest 5.8, longest wait 12.2 | pass |
| AC9 | `npm run verify-image -w worker -- sitetoapk-builder:dev`; then with `sitetoapk-api:latest` | The dev image built, signed and checked the sample app (2686105 bytes) and passed; the other image failed its version check with exit code 1 | pass |
| AC10 | `deploy/compose.prod.yml` on port 8080 | `/`, `/pricing`, `/sitemap.xml` from their files; `/my-apps` and `/install/x` from `app.html`; `/auth/me` and `/health` from the API; the API logged the client's own IP (192.168.65.1), not Caddy's (172.30.0.5) and not a forged `X-Forwarded-For` | pass |
| AC11 | `deploy/README.md`, `docs/FEATURES.md`, `docs/PHASE1.md` | Every setting in `.env.example` is listed with whether it is secret; the before-launch items, the worker service and backups are covered; F01 to F12 are `done` once this is signed off | pass |

Automated totals: `shared` 69 of 69, `server` 239 of 239, `worker` 103 of 103 (run with no other build on Docker, since a running build trips the "no container left" checks), `client` 73 of 73; typecheck 0 errors.

## Fixed during verification
- The first 20-build run killed the worker mid-build. Its two containers kept running while the new worker started two more, and four builds at once ran Docker out of memory: two good builds failed as `compile`, which would have counted against their users. A starting worker now removes every build container before taking jobs (one worker runs per host), and a build that dies from lack of memory (exit 137, or Gradle's "daemon disappeared") fails as `infra`, so it is retried and not counted. Tests: "F12: a new worker starts clean" and "F12: a build starved of memory". Seen for real after AC2: the queued build ran while the worker tests also built in Docker, ran out of memory three times, and ended `failed`, `infra`, `countsTowardLimit: false`.
- The second 20-build run passed every check but the timeout: the load test started its 30-second build before the worker was up, and the new worker removed that container as a leftover. The test now starts it once the worker is taking jobs.
- The journey first failed at "site loads in the app": `example.com` no longer says "Example Domain", and a just-booted emulator showed "System UI isn't responding" over the app. The journey now looks for "documentation examples" and waits out that dialog.

## Known limits
- One 6-build run had two builds fail as `compile` with "Build failed". The load test then deleted their logs, so the cause wasn't seen; it now prints the last 25 log lines of any failed build first. The next 6-build run and the 20-build run before it had no such failure. Watch for it in the load test on the real server.
- Timings are a Mac baseline with the builder under emulation, not production speed.
- `verify-image` must not run while the worker starts, because a starting worker removes every build container, including its one.
- Nothing here ran on a real server. The load test and Lighthouse run again there before launch.
