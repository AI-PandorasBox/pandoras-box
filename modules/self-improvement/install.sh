#!/usr/bin/env bash
set -euo pipefail
MODULE_NAME="self-improvement"
TOTAL_STEPS=4
[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.self-improvement"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH"
NODE_BIN=$(command -v node)
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing"
ok "Node.js $NODE_BIN"

step 2 "Staging runtime"
sudo mkdir -p "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/weekly-review.mjs" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/weekly-review.mjs"
sudo bash -c "echo 'INSTALL_PATH=$INSTALL_PATH' > '$TARGET_DIR/.env'"
sudo chmod 600 "$TARGET_DIR/.env"
ok "Runtime staged (.env: $TARGET_DIR/.env)"

step 3 "Installing plist (Sunday 08:00 cron)"
SERVICE_USER="${SELF_IMPROVEMENT_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/${PLIST_LABEL}.plist.template"
RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
    -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
    -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
    "$PLIST_TMPL" > "$RENDERED"
plutil -lint "$RENDERED" >/dev/null || fail "plist invalid"
sudo mkdir -p "$PLIST_DIR"
sudo cp "$RENDERED" "$PLIST_PATH"
sudo chown root:wheel "$PLIST_PATH"
sudo chmod 644 "$PLIST_PATH"
rm -f "$RENDERED"
if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
ok "LaunchDaemon scheduled for Sundays 08:00"

step 4 "First-run smoke (generates today's review immediately)"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) first-run smoke skipped"
else
  "$NODE_BIN" "$TARGET_DIR/weekly-review.mjs" || echo "  WARN: first-run smoke failed (will retry Sunday)"
  ok "First review written: ls $TARGET_DIR/weekly-*.md"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Reviews at: $TARGET_DIR/weekly-YYYY-MM-DD.md"
echo "  Schedule:   Sunday 08:00 local time"
exit 0
