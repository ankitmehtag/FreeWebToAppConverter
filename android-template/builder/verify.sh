#!/bin/sh
# Prints the facts the worker compares. Run in its own container.
set -eu

aapt2 dump badging /output/app-release.apk | head -1
apksigner verify --print-certs /output/app-release.apk | grep 'SHA-256'

# A Premium build also made a bundle: it must be valid, and show who signed it.
if [ -f /output/app-release.aab ]; then
  keytool -printcert -jarfile /output/app-release.aab | grep 'SHA256:' | head -1 | sed 's/^[[:space:]]*SHA256:[[:space:]]*/AAB SHA256: /'
  if java -jar /opt/bundletool.jar validate --bundle=/output/app-release.aab > /dev/null; then echo 'AAB valid'; fi
fi
