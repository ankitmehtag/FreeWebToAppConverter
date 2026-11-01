# F05 Artifact delivery

Status: approved

## Goal
Move finished APKs from the worker's local folder into private object storage, and hand them out through short-lived signed links with a published checksum. This completes the first full path: one script turns a config into a signed APK that can be downloaded, installed and run.

## Out of scope
- The API routes, My Apps page and QR install (F09). F05 creates links from code and from the script.
- Accounts and ownership checks. Whoever calls the link function is trusted until F06 and F09.
- Build limits per plan (F09).
- Takedown and the abuse report flow (F10). F05 only provides the delete it needs.
- Premium retention and AAB files (F13).

## Requirements

### Upload
- R1: After the post-build checks pass, the worker must upload the APK to a private bucket, and only then mark the build `success`.
- R2: The object key must be built from the plan and build id only, as `free/<buildId>.apk`, never from user text.
- R3: The worker must compute the SHA-256 before upload, and store it with the object's size and key on the build record.
- R4: Upload must set the APK content type and a fixed download filename.
- R5: A failed upload must retry as an infrastructure error, and must never leave a build marked `success`.
- R6: The worker's local APK must be removed once the upload is confirmed.

### Links
- R7: The bucket must allow no public reads, so an object can be fetched only through a signed link.
- R8: A link function must take a build id, and must return a signed GET link with a fixed lifetime, only for a `success` build that has not expired.
- R9: Credentials must stay on the server, and must not appear in logs, build records or links beyond the signature fields.

### Expiry
- R10: Free artifacts must expire after a fixed retention period, through a bucket lifecycle rule.
- R11: The build record must store its expiry time, and the link function must refuse an expired build even if the object still exists.
- R12: A delete function must remove an object and mark the build, so that existing links stop working.

### End to end
- R13: One script must take a config file and an icon, run a real build, and print the signed link and SHA-256.

## Acceptance criteria
- AC1 (R1, R3): Given a passing build, when it finishes, then the object is in the bucket, and the record holds its key, size and SHA-256 before it shows `success`.
- AC2 (R3, R4): Given a signed link, when the file is downloaded, then its SHA-256 matches the record, and the headers give the APK type and fixed filename.
- AC3 (R2): Given a hostile app name, when uploaded, then the key holds only the plan and build id.
- AC4 (R5): Given storage that fails, when the build uploads, then it retries, and never shows `success` without an object.
- AC5 (R6): Given an upload that succeeds, then no local APK remains. Given one that fails for good, then none remains either.
- AC6 (R7): Given an object, when fetched without a signature, with an edited signature, or for a different key, then each request is refused.
- AC7 (R8, R11): Given a link past its lifetime, when used, then it fails. Given a build past its expiry, then no new link is issued.
- AC8 (R8): Given a `failed`, `queued` or unknown build, then no link is issued.
- AC9 (R9): Given a full build, when logs and records are searched, then no credential appears.
- AC10 (R10): Given the bucket, when its lifecycle rules are read, then the Free expiry rule is present.
- AC11 (R12): Given a deleted artifact, when an old link is used, then it fails.
- AC12 (R13): Given a config and an icon, when the script runs, then the printed link downloads an APK that passes `apksigner verify`, installs on the real device and loads the site.

## Decisions
- A signed link lasts 1 hour.
- Free artifacts are kept for 7 days.
- Automated tests use SeaweedFS in Compose, because the MinIO image is no longer published. Real R2 gives the final proof of AC2, AC6, AC7, AC10, AC11 and AC12, because a stand-in can differ from it.
- Development uses the private bucket `freewebtoappconverter` on the `ankit.mehta@programming.com` Cloudflare account, with a token limited to that bucket. Production gets its own bucket at launch.
- The official AWS S3 client handles signing, because R2 speaks the S3 API.

## Open questions
None.
