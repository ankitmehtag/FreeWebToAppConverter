# F03 Tasks

## Design
- `worker` is a new npm workspace. `render({ config, iconPath, plan, versionCode, versionName })` returns `{ dir, gradleArgs }`, where `gradleArgs` is a fixed argv array for F04 to pass to Gradle without a shell.
- The template gets a required `generatedDir` Gradle property, whose `res` and `assets` folders are added to the `main` source set. The sample config, icon and label move out of `main` into `android-template/sample/`, so generated files can't collide with them.
- `shared` also rejects control characters and unpaired surrogates in `appName` and caps it at 50 characters, because they can't be written to XML safely.
- The icon header is read from the file before decoding, so a bomb is rejected on its stated size. `sharp` also runs with a pixel limit of 4096×4096.
- The watermark is a `BuildConfig` flag. It is on unless the worker passes `-PremoveWatermark=true`, which it does only for Premium.

Generated folder:

```
assets/app_config.json
res/values/generated.xml        app_name, splash and icon background colours
res/mipmap-*/ic_launcher.png
res/mipmap-*/ic_launcher_foreground.png
res/mipmap-*/ic_launcher_monochrome.png
res/mipmap-anydpi-v26/ic_launcher.xml
play-store-icon.png             512×512, not packaged in the APK
```

## Slices
- [x] T1: `worker` workspace and stricter `appName` (R2, R3)
  - Tests first: AC2
- [x] T2: Renderer for `app_config.json` and `generated.xml` (R1, R3, R4, R5, R6)
  - Tests first: AC1, AC2, AC4, AC5
- [x] T3: Icon validation and re-encoding (R7, R8)
  - Tests first: AC7, AC8
- [x] T4: Mipmaps, adaptive, monochrome and Play icons (R9, R10)
  - Tests first: file sizes and alpha. Proof: AC9
- [x] T5: Template takes `generatedDir`, sample moves out of `main` (R1, R3, R6)
  - Proof: AC6
- [x] T6: Watermark in the template, set from the plan (R11, R12, R13, R14)
  - Proof: AC10, AC11, AC12
- [x] T7: Build hostile names and rerun the F02 checks on a generated app (all)
  - Proof: AC3, AC9, AC13
