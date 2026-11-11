#!/bin/sh
# Compiles one app. All arguments are Gradle properties, passed on unchanged.
set -eu

export HOME=/work
export GRADLE_USER_HOME=/work/.gradle
export GRADLE_RO_DEP_CACHE=/opt/gradle-ro
export ANDROID_USER_HOME=/work/.android

cp -r /opt/template /work/template
cd /work/template
# Premium builds ask for a bundle as well as the APK.
TASKS="assembleRelease"
for argument in "$@"; do
  if [ "$argument" = "-PbuildBundle=true" ]; then TASKS="assembleRelease bundleRelease"; fi
done
gradle $TASKS --offline --no-daemon --console=plain "$@"
cp app/build/outputs/apk/release/app-release.apk /output/app-release.apk
if [ -f app/build/outputs/bundle/release/app-release.aab ]; then
  cp app/build/outputs/bundle/release/app-release.aab /output/app-release.aab
fi
