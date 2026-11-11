# F13 Tasks

## Design
- App record gets `plan` (`free` default). Only one server function writes it, and the owner's script `scripts/set-plan.ts` calls it until F14 exists.
- Collection `keystores`: appId (unique), encrypted keystore bytes, encrypted passwords and alias, `iv`, `keyId`, certificate SHA-1 and SHA-256, `createdAt`, `downloadedAt`, `deleteAfter`. Creation uses an upsert on the unique `appId`, so retries and parallel builds end with one record.
- AES-256-GCM with a fresh IV per record. The master key comes from `KEYSTORE_MASTER_KEY` in `.env.production`, selected by `keyId` so it can be rotated.
- The worker reads the plan from the database when it starts the build, not from the job. For Premium it writes the keystore and passwords to tmpfs files, mounts them like the shared key, and runs `bundleRelease` as well as `assembleRelease`. Free keeps the APK only.
- The builder image gets whatever AAB needs offline, as a new version built with the DNS builder and checked with `verify-image` extended to check an AAB.
- Premium files are stored without the 7-day expiry, and the R2 lifecycle rule must not touch their prefix.

## Slices
- [ ] T1: `plan` field, the single writer function, and the owner's `set-plan` script, with Free as default (R1, R2)
  - Tests first: AC1
- [ ] T2: Encryption helper for AES-256-GCM with IV and key id, and the `keystores` collection with a unique `appId` (R5)
  - Tests first: AC4
- [ ] T3: Create the keystore on the first Premium build, safe against retries and parallel builds (R3, R4)
  - Tests first: AC2, AC3
- [ ] T4: Worker reads the plan at build start and falls back to Free when it is not Premium (R2, R12)
  - Tests first: AC10
- [ ] T5: Mount the keystore as tmpfs files and keep passwords out of env, arguments, logs, inspect and artifact (R6)
  - Tests first: AC5
- [ ] T6: New builder image version with offline AAB support, and `verify-image` checking an AAB (R8, R9, Q5)
  - Tests first: AC6, AC7
- [ ] T7: Premium build produces APK and AAB with one key, and records SHA-256 and certificate fingerprints (R8, R9)
  - Tests first: AC6, AC7
- [ ] T8: Watermark removed through the Gradle property for Premium only (R11)
  - Tests first: AC9
- [ ] T9: Build page shows both files, fingerprints and the Play App Signing note (R10)
  - Tests first: AC8
- [ ] T10: Premium retention: no 7-day expiry for Premium files, 3 builds a day for every plan (R17)
  - Tests first: AC15
- [ ] T11: One-time key download with confirmation, CSRF, logging, no-cache and owner-only access (R13, R14)
  - Tests first: AC11, AC12
- [ ] T12: Backup reminder emails at 1 and 7 days, stopped by the download (R15)
  - Tests first: AC13
- [ ] T13: 7-day grace before erasing the key on app or account deletion, with the owner emailed and download offered (R7, R16)
  - Tests first: AC14
- [ ] T14: Wizard warning before the first Premium build of an app that already has a Free build (R18)
  - Tests first: AC16
