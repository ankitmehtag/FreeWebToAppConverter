#!/bin/sh
# Builds the sample app with a throwaway test key kept outside the repo.
# Usage: scripts/build-sample.sh [gradle task] [extra -P properties]
set -eu

cd "$(dirname "$0")/.."

: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
export ANDROID_HOME

KEYSTORE="$HOME/.sitetoapk/test.jks"
TEST_PASS="sample-test-only"

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$TEST_PASS" -keypass "$TEST_PASS" \
    -alias test -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=SiteToApk Test"
fi

# Passed by environment so that passwords never appear in the process list.
export ORG_GRADLE_PROJECT_keystorePass="$TEST_PASS"
export ORG_GRADLE_PROJECT_keyPass="$TEST_PASS"

TASK="${1:-assembleRelease}"
[ "$#" -gt 0 ] && shift

./gradlew "$TASK" \
  -PapplicationId=com.sitetoapk.sample \
  -PversionCode=1 \
  -PversionName=1.0 \
  -PappName="Sample App" \
  -PkeystorePath="$KEYSTORE" \
  -PkeyAlias=test \
  "$@"
