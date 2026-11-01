# F04 Build engine

Status: approved

## Goal
Turn a queued build job into a signed, checked APK, in a fresh locked-down container that can't reach anything else, and recover cleanly when a build hangs or the worker dies. This is the riskiest part of the backend, because it runs a compiler over user-supplied input, so it is proven before any web flow depends on it.

## Out of scope
- Uploading to R2, signed download links and retention (F05). F04 leaves the APK in a local artifacts folder.
- The API routes, wizard and auth that create a job. F04 tests enqueue directly.
- Live log streaming to users and the friendly failure messages.
- Plan limits and the one-active-build rule.
- Per-app keystores and AAB output (F13). F04 uses one shared key and APK only.
- Production hosting, autoscaling and the CI that rebuilds the image.

## Requirements

### Builder image
- R1: A versioned builder image must hold JDK 17, the Android SDK, build-tools, the template and a Gradle cache already filled with its dependencies.
- R2: A build must run with `--offline --no-daemon`, and must pass with no network at all.
- R3: The image must contain no signing key, password or secret in any layer.
- R4: The image version must be pinned to `android-template/version.json`, so that a template or SDK change needs a new image.

### Isolation
- R5: Each build must run in a new container, as a non-root user, with a read-only root filesystem, a tmpfs work folder and limits on CPU, memory and process count.
- R6: The container must have no network, no Docker socket and no extra Linux capabilities, and must block privilege escalation.
- R7: Only the generated folder (read-only), the signing files (read-only) and an output folder may be mounted.
- R8: The keystore and its passwords must be files mounted for that build only, and must never appear in environment variables, command arguments, logs or `docker inspect`.
- R9: Gradle must be started with a fixed argv array and no shell.

### Queue and worker
- R10: Jobs must run through BullMQ on Redis, with concurrency set by configuration.
- R11: Mongo `builds` must be the source of truth, moving through `queued`, `building`, `signing`, `uploading`, `success`, `failed` and `canceled`. In F04, `uploading` is the move to the local artifacts folder.
- R12: The worker must call `render` from F03, run the container, run the post-build checks, then store the APK and its SHA-256.
- R13: Before marking success, the worker must confirm with `aapt2 dump badging` that package and version match, verify the signature with `apksigner verify`, and check that the size is sensible.
- R14: Only infrastructure errors may retry automatically. Input and compile errors must fail at once.
- R15: A build must keep its last output lines as its log, with secrets absent.

### Timeouts and recovery
- R16: A build must be killed at a hard timeout, 15 minutes by default, and marked `failed` with that reason.
- R17: If a worker dies mid-build, the job must be recovered, and no build may stay `building` for ever.
- R18: A reaper must fail builds stuck past the timeout, and remove containers with no live build.
- R19: Temp folders and mounted secrets must be removed after every build, whether it passes, fails or is killed.

## Acceptance criteria
- AC1 (R1, R2): Given no network, when a generated app is built, then it passes, and `apksigner verify` and `aapt2 dump badging` show the right package, version and signer.
- AC2 (R3): Given the image, when `docker history` and a search of every layer run, then no key, password or test marker is found.
- AC3 (R4): Given a changed `version.json`, when the worker starts, then it refuses a mismatched image.
- AC4 (R5, R6): Given a probe build, when it runs inside the container, then `id` is non-root, root files can't be written, and it holds no extra capabilities.
- AC5 (R6): Given a probe build, when it tries Redis, Mongo, the API, the host, the internet and the Docker socket, then all of them fail.
- AC6 (R5): Given a probe that uses too much memory or forks without limit, when it runs, then it is stopped and the host stays healthy.
- AC7 (R7, R8): Given a probe, when it writes to the generated or signing folders, then it fails, and `docker inspect` and the build log hold no password.
- AC8 (R9): Given the hostile names from F03, when built through the worker, then each passes with the name shown literally.
- AC9 (R11, R12, R13): Given a valid job, when it runs, then status moves in order to `success`, and the SHA-256 matches the APK.
- AC10 (R13): Given a post-build check that fails, such as a wrong package, when it runs, then the build is `failed` and no artifact is stored.
- AC11 (R14): Given a compile error, then the job fails on its first attempt. Given a lost Docker connection, then it retries.
- AC12 (R10): Given more jobs than the concurrency limit, when queued, then no more than the limit run at once, and all finish.
- AC13 (R16): Given a build that hangs, when the timeout passes, then the container is gone and the build is `failed` with a timeout reason.
- AC14 (R17, R18): Given `kill -9` on the worker mid-build, when it restarts, then the build reaches a final state and no container is left.
- AC15 (R19): Given a pass, a failure and a kill, when each ends, then no temp folder, secret or container remains.

## Decisions
- The worker runs as a plain Node process on the host, not in Compose, because the Docker socket is root-equivalent and should not sit next to the API. Compose publishes Redis and Mongo on `127.0.0.1` for local use.
- This Mac runs the x86-64 image under emulation, so F04 records build time and sets no target. The p50 of 3 minutes is measured on real hosting.
- Each build gets 2 CPUs, 4 GB memory and 512 processes. Concurrency is 1 on this Mac.
- F04 is signed off on this Mac. The first production host reruns AC1 to AC7 as part of its setup.
- F04 signs with the throwaway test key at `~/.sitetoapk/test.jks`. The real shared key is created at launch.

## Open questions
None.
