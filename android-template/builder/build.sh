#!/bin/sh
# Compiles one app. All arguments are Gradle properties, passed on unchanged.
set -eu

export HOME=/work
export GRADLE_USER_HOME=/work/.gradle
export GRADLE_RO_DEP_CACHE=/opt/gradle-ro
export ANDROID_USER_HOME=/work/.android

cp -r /opt/template /work/template
cd /work/template
gradle assembleRelease --offline --no-daemon --console=plain "$@"
cp app/build/outputs/apk/release/app-release.apk /output/app-release.apk
