#!/usr/bin/env bash
# install.sh -- argus (Security Overseer) installer. LaunchDaemon, no HTTP port.
set -euo pipefail

MODULE_NAME="argus"
TOTAL_STEPS=4
[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

DRY_RUN_ACTIVE="${PBOX_DRY_RUN_ACTIVE:-${PBOX_DRY_RUN:-0}}"
MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
STORE_DIR="$TARGET_DIR/store"
RUNTIME_SCRIPT="pbox-argus.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.argus"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"
CLASSIFIER_PORT="${CONTENT_CLASSIFIER_PORT:-8487}"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH"
NODE_BIN=$(command -v node)
ok "Node.js at $NODE_BIN"
[[ -d "$MODULE_SRC_DIR" ]] || fail "runtime dir missing at $MODULE_SRC_DIR"
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$CLASSIFIER_PORT/api/health" 2>/dev/null; then
  ok "content-classifier reachable on :$CLASSIFIER_PORT"
else
  echo "  NOTE: content-classifier not reachable on :$CLASSIFIER_PORT. Install it first (modules/content-classifier)."
fi

step 2 "Staging runtime + store + .env"
sudo mkdir -p "$TARGET_DIR" "$STORE_DIR"
sudo chown -R "$(stat -f '%Su' "$INSTALL_PATH")" "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
ENV_PATH="$TARGET_DIR/.env"
if [[ -f "$ENV_PATH" ]]; then ok ".env preserved"; else
  sudo bash -c "cat > '$ENV_PATH'" <<ENVEOF
INSTALL_PATH=$INSTALL_PATH
ARGUS_POLL_SEC=60
CONTENT_CLASSIFIER_URL=http://127.0.0.1:$CLASSIFIER_PORT
ARGUS_STRIKE_LIMIT=3
ARGUS_FAIL_OPEN=false
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$ENV_PATH"; ok "Wrote $ENV_PATH"
fi

step 3 "Rendering + loading LaunchDaemon"
SERVICE_USER="${ARGUS_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.argus.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"
RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
    -e "s|{{LOG_PREFIX}}|${LOG_PREFIX:-pandoras-box}|g" \
    -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
    "$PLIST_TMPL" > "$RENDERED"
plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ok "Dry-run: plist valid, not installing"; rm -f "$RENDERED"
else
  sudo mkdir -p "$PLIST_DIR"; sudo cp "$RENDERED" "$PLIST_PATH"
  sudo chown root:wheel "$PLIST_PATH"; sudo chmod 644 "$PLIST_PATH"; rm -f "$RENDERED"
  launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null && sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
  sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
  ok "LaunchDaemon loaded: $PLIST_LABEL"
fi

step 4 "Verifying"
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ok "Dry-run: skipping verify"
else
  sleep 1
  launchctl list | grep -q "$PLIST_LABEL" && ok "Registered with launchctl" || echo "[$MODULE_NAME] WARN: not registered (tail /tmp/${LOG_PREFIX:-pandoras-box}-argus.log)"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  REMINDER: for Argus to gate jobs, set CONTENT_CLASSIFIER_INSTALLED=true in the"
echo "  conductor environment and restart it, so jobs wait in PENDING_REVIEW for review."
exit 0
