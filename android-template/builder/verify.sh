#!/bin/sh
# Prints the facts the worker compares. Run in its own container.
set -eu

aapt2 dump badging /output/app-release.apk | head -1
apksigner verify --print-certs /output/app-release.apk | grep 'SHA-256'
