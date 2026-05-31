#!/usr/bin/env bash
# install.sh -- admin-shell module installer
# Creates a Chrome .app bundle that opens the Admin Lite URL in a standalone
# window. No daemon -- this is a one-shot install that places a launcher
# in /Applications and on the Desktop.
set -euo pipefail

MODULE_NAME="admin-shell"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh 2>/dev/null || true

# admin-shell creates a macOS .app bundle that launches Chrome in app mode.
# The Linux equivalent (a .desktop file + xdg-open) is a follow-up; skip cleanly
# on Linux for now so the wider install does not flag it as a failure.
if [[ "${PBOX_OS:-$(uname -s)}" != Darwin ]]; then
  echo "[admin-shell] Linux support pending (macOS .app bundle); skipped."
  exit 0
fi

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

ADMIN_URL="${ADMIN_SHELL_URL:-http://127.0.0.1:8488/}"
APP_NAME="${ADMIN_SHELL_APP_NAME:-Pandoras Box Admin}"
APP_PATH="${ADMIN_SHELL_APP_PATH:-$HOME/Applications/${APP_NAME}.app}"
DESKTOP_LINK="$HOME/Desktop/${APP_NAME}.app"

if [[ "$(uname)" == "Darwin" ]]; then
  CHROME="${PBOX_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
else
  CHROME="${PBOX_CHROME_BIN:-/usr/bin/google-chrome-stable}"
fi

step 1 "Prerequisites"
[[ -x "$CHROME" ]] || fail "Chrome/Chromium not found at $CHROME (set PBOX_CHROME_BIN to override)"
ok "Chrome present"

step 2 "Creating Chrome app bundle"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) .app bundle creation skipped (target: $APP_PATH)"
else
  mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"
  cat > "$APP_PATH/Contents/Info.plist" <<INFO
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>launch</string>
<key>CFBundleIdentifier</key><string>com.pandoras-box.admin-shell</string>
<key>CFBundleName</key><string>${APP_NAME}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSUIElement</key><false/>
</dict></plist>
INFO
  cat > "$APP_PATH/Contents/MacOS/launch" <<LAUNCH
#!/usr/bin/env bash
exec "$CHROME" --app="$ADMIN_URL" --user-data-dir="\$HOME/Library/Application Support/PandorasBoxAdminShell"
LAUNCH
  chmod +x "$APP_PATH/Contents/MacOS/launch"
  ok ".app bundle created: $APP_PATH"
fi

step 3 "Adding Desktop link"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) Desktop link skipped"
else
  rm -f "$DESKTOP_LINK"
  ln -s "$APP_PATH" "$DESKTOP_LINK"
  ok "Desktop link: $DESKTOP_LINK"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  App:  $APP_PATH"
echo "  Opens: $ADMIN_URL"
exit 0
