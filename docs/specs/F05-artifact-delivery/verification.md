# F05 Verification

Run on 2026-11-02. Automated tests used SeaweedFS in Compose. Rows marked "R2" ran on the real `freewebtoappconverter` bucket.

Status: all criteria pass, signed off by the owner on 2026-11-02.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `build-app` on R2 | History `queued`, `building`, `signing`, `uploading`, `success`; record holds key, 2726033 bytes and SHA-256 | pass |
| AC2 | R2: downloaded through the signed link | SHA-256 `adff454a…be61` matches the record; `application/vnd.android.package-archive`; `attachment; filename="app.apk"` | pass |
| AC3 | `npm test -w worker`; R2 record | Key `free/2f46e8e6-….apk`, built from plan and build id only | pass |
| AC4 | `npm test -w worker` with a failing fake store | Retries as `queued`, then `failed`; `success` never appears | pass |
| AC5 | `npm test -w worker` | No APK left after a pass or a final failure | pass |
| AC6 | R2: fetched with no signature, an edited signature and another key | 400, 403, 403 | pass |
| AC7 | R2: 1 second link; `npm test -w worker` for a build past expiry | 200, then 403 after it expired; expired build gets no link | pass |
| AC8 | `npm test -w worker` | `failed`, `queued`, `building` and unknown builds get no link | pass |
| AC9 | Searched the build log and Mongo records for the secret key, access key and signing password | 0 matches | pass |
| AC10 | R2: `wrangler r2 bucket lifecycle list` | `expire-free-artifacts`, enabled, `free/`, 7 days | pass |
| AC11 | R2: used a link after delete; `npm test -w worker` | 404; no new link issued | pass |
| AC12 | `build-app` with a config and an icon, downloaded the link, ran `apksigner`, installed on the moto g35 5G | Signer `c546406a…a024e8`; `Delivery Proof` installed; `F02 home` loaded with the watermark; 0 crashes | pass |

Automated totals: `shared` 42 of 42, `server` 5 of 5, `worker` 90 of 90, typecheck 0 errors.

## Known limits
- The bucket token is Object Read & Write only, so `setup-bucket` can't set the rule with it. The rule was added with `wrangler r2 bucket lifecycle add`. Production setup must do the same, or use a token with bucket admin rights.
- A signed link holds the access key id, as all S3 signed links do. It does not hold the secret. Anyone with a link can download until it expires, so F09 must issue links only to the owner.
- A delete stops links at once, but a link can't be revoked while its object remains. F10's takedown must delete the object.
- A failed upload retries the whole build, which costs compute but is rare.
- The `SeaweedFS` image is a test stand-in and can return `socket hang up` for a few seconds after it restarts.
