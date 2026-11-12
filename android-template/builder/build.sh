#!/bin/sh
# Compiles one app. All arguments are Gradle properties, passed on unchanged.
set -eu

export HOME=/work
export GRADLE_USER_HOME=/work/.gradle
export GRADLE_RO_DEP_CACHE=/opt/gradle-ro
export ANDROID_USER_HOME=/work/.android

cp -r /opt/template /work/template
cd /work/template
# An app with ads is built from the ads flavour, every other app from the one without ad code (F16).
FLAVOR=Noads
LOWER=noads
# Premium builds ask for a bundle as well as the APK.
BUNDLE=no
for argument in "$@"; do
  if [ "$argument" = "-PadsEnabled=true" ]; then FLAVOR=Ads; LOWER=ads; fi
  if [ "$argument" = "-PbuildBundle=true" ]; then BUNDLE=yes; fi
done
TASKS="assemble${FLAVOR}Release"
if [ "$BUNDLE" = yes ]; then TASKS="$TASKS bundle${FLAVOR}Release"; fi
gradle $TASKS --offline --no-daemon --console=plain "$@"
cp "app/build/outputs/apk/$LOWER/release/app-$LOWER-release.apk" /output/app-release.apk
if [ -f "app/build/outputs/bundle/${LOWER}Release/app-$LOWER-release.aab" ]; then
  cp "app/build/outputs/bundle/${LOWER}Release/app-$LOWER-release.aab" /output/app-release.aab
fi
