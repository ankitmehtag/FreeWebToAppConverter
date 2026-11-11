# F13 Verification

Run on 2026-11-12. Test counts: server 18 files, 279 tests; worker 14 files, 125 tests; shared 6 files, 84 tests. All pass. One worker test failed once in a full run and passed on the next run, with no change to the code.

Real image check, on the production server, with `sitetoapk-builder:v4`:

```
Image sitetoapk-builder:v4 matches android-template/version.json
PASS: signed by the expected key, package and version checked, 3312579 bytes, SHA-256 a45c878f...
PASS: Premium build made its own key D3:07:D4:AB:3C:51:DE:9B…, an APK of 3312663 bytes and an AAB of 3108699 bytes
```

That second build ran `keygen.sh` (keytool), `bundleRelease`, `apksigner verify`, `bundletool validate` and the signer comparison for the APK and the AAB, inside real containers.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `server/test/plan.test.ts`: plan sent on create, on save, in the draft; unknown stored value | 7 tests pass; plan stays Free | pass |
| AC2 | `worker/test/premium.test.ts` first and second build; `verify-image` Premium sample | one `keygen` call, one record; real key made | pass |
| AC3 | `worker/test/premium.test.ts` two parallel builds; `server/test/keystore.test.ts` 8 parallel creates | one key, both builds show its certificate | pass |
| AC4 | `shared/test/keystore.test.ts`, `server/test/keystore.test.ts` | raw document has no alias, password or key bytes, plain or base64; wrong key, changed record and moved record fail | pass |
| AC5 | `worker/test/premium.test.ts` secrets test | password absent from arguments, saved log and artifact keys; work folder removed. `docker inspect` and the container environment were not searched on the real server | pass for tests, owner may spot-check |
| AC6 | `verify-image` Premium sample | APK and AAB built and checked with the same certificate | pass |
| AC7 | `worker/test/premium.test.ts` Free build | APK only, shared key, no bundle task | pass |
| AC8 | `server/test/premium-builds.test.ts` for the data; client builds | build page data has both files, fingerprints; the page itself was not looked at in a browser | pass for data, owner to look at the page |
| AC9 | `worker/test/premium.test.ts` checks `-PremoveWatermark=true` for Premium only | the APK was not run on a phone | owner to check on a phone |
| AC10 | `worker/test/premium.test.ts` plan read at start | asked Premium, app Free, missing or unknown: built as Free with the watermark | pass |
| AC11 | `server/test/keystore-routes.test.ts` | zip with key and details; `no-store`; logged; second try 409; 3 parallel tries, one 200 | pass |
| AC12 | `server/test/keystore-routes.test.ts` | another user gets 404 and nothing is marked | pass |
| AC13 | `worker/test/key-upkeep.test.ts` | one reminder after a day, one after a week, none after download, retry after a failed send. A real Resend email was not sent | pass for tests, owner to receive one real email |
| AC14 | `worker/test/key-upkeep.test.ts` | owner told, key kept during the wait, erased after 7 days. No code path schedules it yet, because an app that has been built cannot be deleted and accounts cannot be deleted | pass for the mechanism, trigger arrives with account or app deletion |
| AC15 | `shared/test/builds-expiry.test.ts`, `worker/test/premium.test.ts`, `server/test/premium-builds.test.ts` | Premium has no date and downloads; Free expires | pass |
| AC16 | `server/test/premium-builds.test.ts` for the flag; client checkbox in `build-panel.tsx` | flag true only for a Premium app with Free builds and no Premium build; the checkbox was not clicked in a browser | owner to look |

Deployed on 2026-11-12: worker and API on commit 6e5486a, builder image v4, `KEYSTORE_MASTER_KEY` in the server's `.env.production`, a copy in `~/Documents/sitetoapk-backup/keystore-master-key.txt`, and `/keystores` routed in Caddy (answers 401 without a session).

Not yet done by a person: a Premium build of a real app on production, the key download in a browser, the AAB in a Play Console upload, and the watermark check on a phone.

Sign-off: owner, 2026-11-12. Production Premium build of app 6af43b8b05c7ded41e26c2d9 (v1.1) succeeded: own key, AAB 3109033 bytes, signer 3E:4B:95:90..., no expiry. The owner signed off after their own checks.
