# F04 Tasks

## Design
- `android-template/Dockerfile` builds the image for `linux/amd64`, with the base image, Gradle and SDK downloads pinned by checksum.
- The image is labelled with the SHA-256 of `version.json`, and the worker refuses an image whose label differs.
- Dependencies are baked into a read-only Gradle cache at `/opt/gradle-ro`, used through `GRADLE_RO_DEP_CACHE`. Each build copies the template to a tmpfs at `/work` and runs from there.
- `build.sh` compiles and copies the APK to `/output`. `verify.sh` runs the post-build checks in a second fresh container, so that a build can't vouch for itself.
- Passwords are read from files by `keystorePassFile` and `keyPassFile` Gradle properties.
- Containers carry a `sitetoapk.build` label, which the reaper uses to find them.

## Slices
- [x] T1: Builder image, password files and offline build (R1, R2, R3, R4, R8, R9)
  - Proof: AC1, AC2
- [x] T2: Locked-down container runner (R5, R6, R7, R16, R19)
  - Tests first against probe containers: AC4, AC5, AC6, AC7, AC13
- [x] T3: Image version check (R4)
  - Tests first: AC3
- [x] T4: Post-build checks (R13)
  - Tests first: AC10
- [x] T5: Queue, Mongo status and worker (R10, R11, R12, R14, R15)
  - Tests first: AC9, AC11, AC12
- [x] T6: Reaper and crash recovery (R17, R18, R19)
  - Proof: AC14, AC15
- [x] T7: Hostile names through the worker and the full pass (all)
  - Proof: AC1 to AC15
