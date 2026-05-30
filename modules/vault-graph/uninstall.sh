#!/usr/bin/env bash
set -euo pipefail
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
[[ -f "$INSTALL_PATH/theme.conf" ]] && source "$INSTALL_PATH/theme.conf"
PREFIX="${LAUNCHDAEMON_PREFIX:-com.pandoras-box}"
PLIST="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/${PREFIX}.vault-graph.plist"
if [[ -f "$PLIST" ]]; then
  sudo launchctl unload "$PLIST" 2>/dev/null || true
  sudo rm -f "$PLIST"
  echo "[vault-graph] removed $PLIST"
fi
echo "[vault-graph] uninstalled (vault kept at $INSTALL_PATH/vault-graph/vault)"
