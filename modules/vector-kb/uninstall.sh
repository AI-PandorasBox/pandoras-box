#!/usr/bin/env bash
# uninstall.sh -- remove the vector-kb LaunchDaemon. Leaves your store/ in place
# (delete $INSTALL_PATH/vector-kb/store yourself if you also want the vectors gone).
set -euo pipefail
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
[[ -f "$INSTALL_PATH/theme.conf" ]] && source "$INSTALL_PATH/theme.conf"
PREFIX="${LAUNCHDAEMON_PREFIX:-com.pandoras-box}"
PLIST="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/${PREFIX}.vector-kb.plist"
if [[ -f "$PLIST" ]]; then
  sudo launchctl unload "$PLIST" 2>/dev/null || true
  sudo rm -f "$PLIST"
  echo "[vector-kb] removed $PLIST"
fi
echo "[vector-kb] uninstalled (store kept at $INSTALL_PATH/vector-kb/store)"
