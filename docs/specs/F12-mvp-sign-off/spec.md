# F12 MVP sign-off

Status: approved

## Goal
Prove that Phase 1 works as one product, not only as separate features, and make it ready to run on a real server. One command takes a stranger from sign-up to the app running on an Android emulator. A load test shows that many builds at once stay isolated, tidy and free of secrets. A sample build script guards every new builder image. A production setup serves the site the way F11 needs, and is proven locally. With these done, Phase 1 is signed off and only the paid launch steps remain.

## Out of scope
- Renting a server, pointing the domain at it, and going live. That costs money, and happens as a separate launch step when the owner chooses.
- Payments, Premium and every other Phase 2 feature.
- GitHub Actions or any other hosted CI, which the plan rules out. The scripts here run by hand.
- Monitoring, error tracking and backups beyond a written plan for them.

## Requirements

### End-to-end journey
- R1: One command must run the whole journey against the local stack (Compose, the worker on the host, and the built site): sign up, confirm the email from Mailpit, sign in, create an app for a public HTTPS site, upload an icon, start a build, follow its log to success, download the APK and check its SHA-256.
- R2: The same command must install that APK on the `Medium_Phone_API_36.1` emulator with `adb`, open it, confirm that the site's page has loaded inside the app, and uninstall it.
- R3: The command must fail with a clear step name when any step fails, and save a screenshot or log for that step.

### Load
- R4: A load script must queue 20 builds at once, each with its own app name, package name and a unique marker in its config, through the normal queue.
- R5: The worker must never run more builds at once than its configured concurrency, and every build must reach `success`, or `failed` with a recorded reason.
- R6: After the run, there must be no build container, work folder or mounted secret left on the host, and Redis must hold no live log list past its expiry.
- R7: Each APK must contain only its own config: its package name, app name and marker, and no other build's.
- R8: No signing password, keystore path, storage key or environment secret may appear in any stored log, build record or live log from the run.
- R9: During the run, a build given a tiny timeout must be killed and marked `failed`, and killing the worker mid-run and starting it again must finish every build with none stuck.
- R10: The script must report build time (median and slowest) and queue wait.

### Builder image check
- R11: `npm run verify-image -w worker -- <image>` must build the sample config with the given image in the normal locked-down container, check it with `aapt2` and `apksigner`, and exit non-zero on any problem. The worker README must say to run it before every image rollout.

### Production setup
- R12: A production Compose file and a Caddy reverse proxy must serve the built site and the API from one origin: each public page from its `.html` file, every other path from `app.html`, and `/auth`, `/apps`, `/url`, `/builds` and `/reports` from the API, with `TRUST_PROXY` set to the proxy.
- R13: The production setup must run locally, end to end, before any server is rented.
- R14: A deploy guide must list every setting, which ones are secret, the before-launch items from `FEATURES.md`, how to run the worker on the build host, and how to back up Mongo and the bucket.

### Sign-off
- R15: Every Phase 1 feature in `FEATURES.md` must be `done`, and a short Phase 1 summary must record what was proven and what launch still needs.

## Acceptance criteria
- AC1 (R1, R2): Given the local stack and the emulator, when the journey command runs, then it passes every step, and the app on the emulator shows the site's page.
- AC2 (R3): Given the worker stopped, when the journey runs, then it fails at the build step by name and saves what it saw.
- AC3 (R4, R5): Given 20 queued builds and a concurrency of 2, then no more than 2 build containers run at any sample, and all 20 end in `success`.
- AC4 (R6): Given the finished run, then `docker ps -a` shows no build container, the work root is empty, and no secrets folder remains.
- AC5 (R7): Given the 20 APKs, when each one's `app_config.json` is read, then it holds only its own package name, app name and marker.
- AC6 (R8): Given every stored log, build record and captured live line, when searched for the test secrets, then none is found.
- AC7 (R9): Given one build with a 30-second timeout, then it is killed and `failed` with the timeout reason. Given the worker killed mid-run and restarted, then every build still ends, and none stays `building`.
- AC8 (R10): Given the run, then the script prints the median and slowest build time and the longest queue wait.
- AC9 (R11): Given the current builder image, then `verify-image` passes. Given an image whose `version.json` hash doesn't match, then it fails.
- AC10 (R12, R13): Given the production Compose running locally, when `/`, `/pricing`, `/my-apps`, `/install/x`, `/sitemap.xml` and `/auth/me` are fetched through Caddy, then each answers with the right file or the API, and the API sees each visitor's own IP.
- AC11 (R14, R15): Given the deploy guide and `FEATURES.md`, then every setting is listed and Phase 1 shows all features `done`.

## Decisions
- The load test runs on the Mac with a concurrency of 2, because each build takes 2 CPUs and 4 GB, and the builder runs under emulation. Timings are recorded as a Mac baseline, not as production speed.
- The journey uses `example.com` as the public site, because the emulator can reach it and its page has known text. Its page changed during F12, so the journey looks for "documentation examples", and `JOURNEY_SITE_TEXT` changes that.
- Caddy is the proxy, because it serves static files, routes the API and gets TLS certificates in one small config.
- Spending stays as low as possible (owner, 2026-11-07). Going live is its own step, taken when the owner is ready to pay, on the smallest server that can run the builder: one x86-64 machine with at least 4 CPUs and 8 GB that runs Caddy, the API, Mongo, Redis and the worker together, so there is no separate database or Redis bill. R2 and Resend stay on their free allowances.
- The load test runs 20 builds at a concurrency of 2 on the Mac, and runs again on the real build host before launch.
- The journey runs on the emulator only. The real phone was proven in F09.
- Builds in the load test are queued straight through the worker's queue, as the F05 scripts do, so the 3-a-day limit for users doesn't slow the test. The journey still goes through the website.

## Open questions
None.
