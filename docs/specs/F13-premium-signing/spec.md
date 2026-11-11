# F13 Premium signing

Status: approved

## Goal
Give a Premium app what a Free app cannot have: its own signing key, an Android App Bundle (AAB) ready for Google Play, and no "Made with" watermark. The key is the heart of it. An app that updates on Google Play must be signed by the same key for ever, so the key must be created once, stored so it cannot leak, never lost, and handed to the owner in a way that makes them keep a copy.

## Out of scope
- Selling Premium, prices, orders and refunds (F14). F13 reads one plan flag on the app. Until F14 exists, the owner sets that flag by a script, so F13 can be built and tested alone.
- Checking that the user owns the website, assetlinks and domain verification (F19).
- Push credentials, ads and other Premium add-ons (F15, F16).
- Publishing the app to Google Play for the user (F21).
- User-supplied keystores. The platform creates the key. Importing one can be a later feature.

## Requirements

### Plan flag
- R1: Every app must have a plan, Free or Premium, set only by server code (the F14 path, or the owner's script until then). The user's browser, `app_config.json` and the API from a normal user must not be able to set it.
- R2: Free must be the default. A missing or unknown plan value must behave as Free, in the server and in the worker.

### Per-app key
- R3: The first Premium build of an app must create a new keystore for it, with `keytool`, a random strong password and a random alias, valid for at least 25 years. Later builds of the same app must reuse that key and never create a second one.
- R4: Key creation must be safe to repeat: two builds starting at once, or a retry after a crash, must still end with exactly one key for the app.
- R5: The keystore and its passwords must be stored encrypted with AES-256-GCM, a unique IV per record and a key id field, so the master key can be replaced later. The master key must live only in the server's secret environment, never in the repo, image, logs or database.
- R6: The keystore and passwords must reach the build only as files on a tmpfs mount for that run, as F04 already does for the shared key, and must never appear in environment variables, command arguments, logs, `docker inspect` or the artifact.
- R7: Deleting an app or an account must delete its key, but only after the 7-day grace period in R16, so a mistake can be undone.

### Builds and outputs
- R8: A Premium build must produce a signed APK and a signed AAB, signed with the app's own key. A Free build must still produce only the APK, signed with the shared key.
- R9: The AAB must pass `bundletool validate` and be signed so Google Play accepts it as an upload. The result must record each file's SHA-256 and the signing certificate's SHA-1 and SHA-256.
- R10: The build page must show both files, the certificate fingerprints, and a short explanation of Play App Signing: the key we made is the upload key, and Google may hold the final signing key.
- R11: A Premium build must not show the watermark. The watermark must be removed by the worker from the plan flag through the Gradle property from F03, not by anything the user can edit.
- R12: If the plan flag is not Premium at the moment the worker starts the build, the worker must build as Free, whatever the build request said.

### Key download and backup
- R13: The owner of a Premium app must be able to download the keystore once, together with its alias and passwords in one text file, after confirming that they understand losing it means no more updates on Google Play.
- R14: The download must happen over a signed-in, CSRF-protected request, must be logged with time and user, and must never be cached.
- R15: A user who has not downloaded the key must get a backup reminder email one day and seven days after the first Premium build.
- R16: When an account or Premium app is deleted, the key must be kept for 7 days, the owner emailed, and the keystore download offered during that time. After 7 days it must be erased.

### Retention and limits
- R17: Premium build files must be kept while the account is active, not expire after 7 days. The 3 builds a day limit must stay for every plan.
- R18: A signed APK installs over an older one only if both use the same key. The wizard must warn, before the first Premium build of an app that already has a Free build, that people who installed the Free APK must uninstall it first.

## Acceptance criteria
- AC1 (R1, R2): Given a normal signed-in user, when they try to set an app's plan to Premium through the API or `app_config.json`, then it is rejected and the plan stays Free. A missing or unknown plan builds as Free.
- AC2 (R3): Given a Premium app with no key, when its first build runs, then a keystore with a 25-year certificate is created, and a second build reuses the same certificate.
- AC3 (R4): Given two Premium builds for one app started at the same moment, when both finish, then exactly one key exists and both artifacts carry its certificate.
- AC4 (R5): Given the database and a backup of it, when searched for the keystore or its passwords in plain form, then none are found, and a record can be decrypted only with the master key.
- AC5 (R6): Given a Premium build, when its logs, container environment, command line and `docker inspect` output are searched for the passwords, then none are found, and the artifact contains no keystore.
- AC6 (R8, R9): Given a Premium build, when it finishes, then `apksigner verify` passes on the APK and `bundletool validate` passes on the AAB, and both show the same certificate.
- AC7 (R8): Given a Free build, when it finishes, then there is only an APK, signed with the shared key.
- AC8 (R10): Given a finished Premium build, when its page is opened, then both files, the SHA-256 values, the certificate fingerprints and the Play App Signing note are shown.
- AC9 (R11): Given a Premium build, when the APK runs on a phone, then there is no watermark on the page, offline, SSL and error screens.
- AC10 (R12): Given a build request made while the app was Premium, when the plan is set back to Free before the worker starts it, then the worker builds it as Free with the watermark.
- AC11 (R13, R14): Given the owner of a Premium app, when they download the key after confirming, then they get the keystore and a text file with alias and passwords, the download is logged, and a second attempt is refused.
- AC12 (R13): Given another user, when they request the key of this app, then it is refused.
- AC13 (R15): Given a Premium app whose key has not been downloaded, when one day and seven days pass, then two reminder emails are sent, and none after the key is downloaded.
- AC14 (R7, R16): Given a deleted Premium app, when 7 days pass, then the key is erased, and before that the owner could still download it.
- AC15 (R17): Given a Premium build older than 7 days, when its link is opened, then it still works, and a Free build older than 7 days does not.
- AC16 (R18): Given an app with a Free build that is about to get its first Premium build, when the user starts it, then the wizard shows the uninstall warning first.

## Open questions
- Q1: Decided on 2026-11-12: the master key is a long random value in the server's `.env.production`, with a copy in `~/Documents/sitetoapk-backup/`. No cloud key service. If the master key is lost, every Premium key is lost.
- Q2: Decided on 2026-11-12: the key can be downloaded once, after a confirmation box, with the two reminder emails.
- Q3: Decided on 2026-11-12: one key per app signs both the APK and the AAB.
- Q4: Decided on 2026-11-12: after a refund, builds made while Premium keep the app's own key, new Free builds use the shared key, and the Pricing page and the refund email warn that installed users must reinstall.
- Q5: Decided on 2026-11-12: a new builder image version is built and verified with the DNS builder, and its size and build time are checked before sign-off.
- Q6: Decided on 2026-11-12: F13 adds no paid service and no extra limit; the 3 builds a day cap stays.
