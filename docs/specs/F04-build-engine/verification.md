# F04 Verification

Run on 2026-11-01 on Apple Silicon with Docker 29.9.2. The `linux/amd64` builder image ran under emulation. Worker runs used real Docker, Redis and Mongo, except where a row says the unit tests.

Status: all criteria pass, signed off by the owner on 2026-11-01.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | Rendered an app and built it with `--network none`, `--read-only` and all limits | `apksigner` and `aapt2` show `com.sitetoapk.generated`, 3 / 1.2.3, signer `c546406a…a024e8` | pass |
| AC2 | `docker history --no-trunc`; searched the image for key files and the test password | 0 matches | pass |
| AC3 | `npm test -w worker` | Matching image accepted; other hash and missing image refused | pass |
| AC4 | Probe container | `id -u` 1000; root files read-only; `CapEff` 0 | pass |
| AC5 | Probe tried Redis, Mongo, API, host and 1.1.1.1, and the Docker socket | All 5 blocked; socket absent; empty route table | pass |
| AC6 | Probe filled memory; probe ran a fork bomb | Killed with code 137; Docker stayed healthy | pass |
| AC7 | Probe wrote to mounts; `docker inspect` during a run | Generated and secrets read-only; output writable; password absent | pass |
| AC8 | 12 F03 hostile names through the real worker | 12 of 12 built and labelled literally. `aapt2 dump badging` printed `A` with a doubled backslash, and the APK's string pool holds one | pass |
| AC9 | Real job through the queue | `queued`, `building`, `signing`, `uploading`, `success`; SHA-256 matches the file; password absent from Mongo and logs | pass |
| AC10 | `npm test -w worker` | Wrong package, version, signer or size: `failed`, no artifact | pass |
| AC11 | `npm test -w worker` | Compile and input errors fail at once; Docker failure retries, then fails on the last attempt. Shown with a fake runner, not a real Docker outage | pass |
| AC12 | `npm test -w worker` with BullMQ on real Redis | 6 jobs at concurrency 2: peak 2, all succeeded | pass |
| AC13 | Worker with a 30 second timeout | `failed`, `Build timed out`, in 34 seconds; no container | pass |
| AC14 | `kill -9` on the worker mid-build, confirmed 0 workers, then restarted | Container outlived the worker; retry removed it and reached `success`; nothing left | pass |
| AC15 | After a pass, a timeout and a kill | 0 containers, 0 work folders, 0 password files | pass |

Automated totals: `shared` 42 of 42, `server` 5 of 5, `worker` 76 of 76, typecheck 0 errors.

Build time under emulation: 273 seconds through the worker. This is not a production number.

## Known limits
- Between a worker crash and its recovery, the keystore and passwords stay in `WORK_ROOT`, as shown in AC14. `WORK_ROOT` must be a tmpfs in production.
- The first production host must rerun AC1 to AC7, because isolation here ran inside Docker Desktop's Linux VM.
- `docker kill` semantics on the timeout path use `docker rm -f`, so a build gets no chance to clean up. Nothing it could leave survives its tmpfs.
