# F05 Tasks

## Design
- `worker/src/storage.ts` wraps the S3 client, so the rest of the worker never handles credentials. Its checksum options are set to `WHEN_REQUIRED`, because R2 rejects the client's newer defaults.
- Keys are `free/<buildId>.apk`, so the lifecycle rule can target the `free/` prefix and Premium can be kept in F13.
- The worker confirms the upload with `HeadObject` before it marks `success`.
- `worker/src/links.ts` issues links and deletes artifacts. F09 calls it from the API.
- The APK is removed with the build's work folder, which already happens on every path.
- `scripts/setup-bucket.ts` applies the lifecycle rule, and `scripts/build-app.ts` is the one-command path.

## Slices
- [x] T1: Storage wrapper and SeaweedFS in Compose (R2, R4, R7)
  - Tests first: AC3, AC6
- [x] T2: Upload in the build pipeline (R1, R3, R5, R6)
  - Tests first: AC1, AC4, AC5
- [x] T3: Signed links, expiry and delete (R8, R9, R10, R11, R12)
  - Tests first: AC2, AC7, AC8, AC11
- [x] T4: Bucket setup and the build script (R10, R13)
  - Proof: AC9, AC10
- [x] T5: Real R2 and the real device (all)
  - Proof: AC2, AC6, AC7, AC10, AC11, AC12
