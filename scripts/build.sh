#!/usr/bin/env bash
# Packages app/ + service/ into dist/com.lfkdsk.aerials_<version>_all.ipk
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ARES_PACKAGE:=ares-package}"
command -v "$ARES_PACKAGE" >/dev/null || { echo 'Install the webOS CLI (npm i -g @webos-tools/cli) or set ARES_PACKAGE.' >&2; exit 1; }
mkdir -p dist
umask 022
"$ARES_PACKAGE" app service -o dist
ls -la dist/*.ipk
