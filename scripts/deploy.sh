#!/usr/bin/env bash
# Build, install and launch on a TV paired with the webOS CLI.
#   DEVICE=<ares device name> scripts/deploy.sh            # build + install + launch
#   DEVICE=<ares device name> scripts/deploy.sh inspect    # open remote DevTools for the app
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEVICE:?set DEVICE to the ares-setup-device profile name}"
if [[ "${1:-}" == inspect ]]; then exec ares-inspect -d "$DEVICE" --app com.lfkdsk.aerials; fi
scripts/build.sh
ares-install -d "$DEVICE" dist/com.lfkdsk.aerials_*_all.ipk
ares-launch -d "$DEVICE" com.lfkdsk.aerials
