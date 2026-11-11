#!/bin/sh
# Makes the signing key for one Premium app. The alias and the password come as files, and the key
# store is written to /output. Prints the certificate fingerprints, which the worker reads.
set -eu

keytool -genkeypair \
  -keystore /output/key.jks -storetype PKCS12 \
  -alias "$(cat /secrets/alias)" \
  -keyalg RSA -keysize 2048 -validity 9125 \
  -dname "CN=Premium app, O=Free Website to App Converter" \
  -storepass:file /secrets/store.pass -keypass:file /secrets/key.pass 2>&1
keytool -list -v -keystore /output/key.jks -storepass:file /secrets/store.pass | grep -E 'SHA1:|SHA256:'
