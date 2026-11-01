# F03 App generation

Status: approved

## Goal
Turn one validated app record and one uploaded icon into the files a build needs, in a temp folder, with no user value able to change the build or break out of its file. This replaces the hand-written sample values from F02 and adds the Free plan watermark, so that F04 only has to run the result.

## Out of scope
- The builder image, queue, container isolation and production signing (F04).
- The wizard, upload API and auth. F03 takes its input as function arguments.
- Where the plan comes from. F03 takes it as an input, and payments set it later (F13).
- White label options beyond removing the watermark (F13).
- Fetching a favicon or theme colour from the site.
- The denylist of bank and brand lookalikes.

## Requirements

### Renderer
- R1: A `render` function in `worker/` must take an `AppConfig`, an icon file and a plan, and write all generated files into a new temp folder. It must not edit `android-template/`.
- R2: It must reject input that fails the `shared` schema, before writing anything.
- R3: `appName` must reach the APK only through a generated XML resource file, escaped for Android resources. This replaces the F02 `appName` Gradle property and the `resValue` line.
- R4: `app_config.json` must be written with a JSON serialiser, and must hold only the fields the schema allows.
- R5: No user value may appear in a Gradle file, a Kotlin file, a shell command or a file path. `packageName`, `versionCode` and `versionName` stay as Gradle properties, passed as a fixed argv array, and only `packageName` comes from the user, after the schema check.
- R6: The splash background must be rendered from `ui.statusBarColor`, so that each app's splash matches its bar.

### Icon pipeline
- R7: An icon must be a real PNG by its magic bytes, at most 5 MB, square, and between 512×512 and 4096×4096. Anything else is rejected with a stated reason, before decoding the full image where possible.
- R8: An accepted icon must be re-encoded with `sharp`, which drops metadata and any trailing data.
- R9: The renderer must generate all launcher mipmaps, an adaptive icon with the artwork inside the 66% safe zone, a monochrome themed icon and a 512×512 Play Store icon.
- R10: The adaptive icon must use a plain background, with an alpha check so that a transparent logo stays visible.

### Watermark
- R11: On the Free plan the app must show a native "Made with SiteToApk" label that is not part of the web page.
- R12: The watermark must be switched by a Gradle property set by the worker from the plan, never by `app_config.json`. The Free state must be the default, so a missing property shows the watermark.
- R13: The app must ignore any watermark-like field in `app_config.json`, and the schema must reject it.
- R14: The watermark must stay visible on the page, offline, SSL and error screens, must not cover page content, and must not intercept taps meant for the page.

## Acceptance criteria
- AC1 (R1): Given valid input, when rendered twice, then two separate temp folders are created with matching files, and `git status` in `android-template/` shows no change.
- AC2 (R2): Given a config that fails the schema, when rendered, then it is rejected and no folder is left behind.
- AC3 (R3, R5): Given hostile names, including `"; rm -rf /`, `</string><evil/>`, `@string/x`, `?attr/y`, `%1$s`, `A`, quotes, apostrophes, emoji and right-to-left text, when each is built and installed, then the build passes and the launcher label shows the name literally.
- AC4 (R4): Given a hostile value in any string field, when rendered, then `app_config.json` parses back to the same value and has no extra field.
- AC5 (R5): Given a render, when `grep` searches the generated Gradle and Kotlin files for a marker name, then there are no matches.
- AC6 (R6): Given two colours, when built, then each splash shows its colour.
- AC7 (R7): Given a renamed JPEG, an HTML file named `.png`, a truncated PNG, a 511×511 PNG, a non-square PNG, a file over 5 MB and a decompression bomb, when rendered, then each is rejected with its reason and without exhausting memory.
- AC8 (R8): Given a PNG with metadata and data after its end marker, when rendered, then neither appears in the output.
- AC9 (R9, R10): Given opaque and transparent icons, when built, then `aapt2 dump badging` lists the icon, and the launcher shows it on a round mask and in themed mode with nothing clipped.
- AC10 (R11, R12): Given a Free build and a build with no plan property, when started, then the label shows. Given a Premium build, then it does not.
- AC11 (R12, R13): Given a Free app, when `app_config.json` is edited to add a watermark field and the APK is rebuilt, then the schema rejects it, and a forced build still shows the label.
- AC12 (R14): Given a Free build, when the page, offline, SSL and config error screens show, then the label is visible on each, and a link at the bottom of the page can still be tapped.
- AC13 (all): Given the F02 checks, when rerun on a generated app on `Medium_Phone_API_36.1` and the real device, then they still pass.

## Decisions
- `render` lives in a new `worker` npm workspace, so `sharp` does not reach `client` or `shared`.
- The watermark is a strip of about 24dp under the WebView, reading "Made with SiteToApk" in small text. It is not tappable, and it takes its own space, so it covers nothing.
- R12 stops config edits. Someone who decompiles an APK can always remove a label, so that is out of scope.
- The adaptive icon background is `ui.statusBarColor` when the logo is transparent, and white otherwise.
- A transparent logo is accepted. A non-square logo is rejected with a clear message and is not cropped.
- The app label moves from a Gradle property to a generated resource, replacing that part of F02 R2.

## Open questions
None.
