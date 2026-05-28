#!/usr/bin/env bash
# install.sh -- browser-actions. Local Playwright Chromium, token + allowlist gated.
set -euo pipefail
MODULE_NAME="browser-actions"
TOTAL_STEPS=4
[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers
step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }
DRY=${PBOX_DRY_RUN_ACTIVE:-${PBOX_DRY_RUN:-0}}
MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-browser-actions.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.browser-actions"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"; PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"
PORT="${BROWSER_ACTIONS_PORT:-8483}"; BIND="${BROWSER_ACTIONS_BIND:-127.0.0.1}"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH"
NODE_BIN=$(command -v node); ok "Node.js at $NODE_BIN"
[[ -d "$MODULE_SRC_DIR" ]] || fail "runtime dir missing"

step 2 "Staging + Playwright + token + .env"
sudo mkdir -p "$TARGET_DIR/store"
sudo chown -R "$(pbox_stat_owner "$INSTALL_PATH")" "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
if [[ "$DRY" == "1" ]]; then
  ok "(dry-run) would npm install playwright + npx playwright install chromium"
else
  ( cd "$TARGET_DIR" && [[ -f package.json ]] || npm init -y >/dev/null 2>&1; npm install playwright >/dev/null 2>&1 && npx playwright install chromium >/dev/null 2>&1 ) \
    && ok "Playwright + Chromium installed" || echo "[$MODULE_NAME] WARN: Playwright install failed; run it in $TARGET_DIR"
fi
ENV_PATH="$TARGET_DIR/.env"
if [[ -f "$ENV_PATH" ]]; then ok ".env preserved (token kept)"; else
  TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  sudo bash -c "cat > '$ENV_PATH'" <<ENVEOF
BROWSER_ACTIONS_PORT=$PORT
BROWSER_ACTIONS_BIND=$BIND
BROWSER_ACTIONS_TOKEN=$TOKEN
BROWSER_ACTIONS_ALLOWLIST=
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$ENV_PATH"
  ok "Wrote $ENV_PATH (token generated; set BROWSER_ACTIONS_ALLOWLIST to enable navigation)"
fi

step 3 "Rendering + loading LaunchDaemon"
SERVICE_USER="${BROWSER_ACTIONS_USER:-$(pbox_stat_owner "$INSTALL_PATH")}"
if [[ "$PBOX_OS" == Darwin ]]; then
  PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.browser-actions.plist.template"
  [[ -f "$PLIST_TMPL" ]] || fail "plist template missing"
  RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
  sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
      -e "s|{{NODE_BIN}}|${NODE_BIN}|g" -e "s|{{LOG_PREFIX}}|${LOG_PREFIX:-pandoras-box}|g" -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
      "$PLIST_TMPL" > "$RENDERED"
  plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"
  if [[ "$DRY" == "1" ]]; then ok "Dry-run: plist valid, not installing"; rm -f "$RENDERED"; else
    sudo mkdir -p "$PLIST_DIR"; sudo cp "$RENDERED" "$PLIST_PATH"; sudo chown root:wheel "$PLIST_PATH"; sudo chmod 644 "$PLIST_PATH"; rm -f "$RENDERED"
    launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null && sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
    sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
    ok "LaunchDaemon loaded: $PLIST_LABEL"
  fi
else
  BA_LOG="/tmp/${LOG_PREFIX:-pandoras-box}-browser-actions.log"
  pbox_create_service "$PLIST_LABEL" "$NODE_BIN" "$TARGET_DIR/$RUNTIME_SCRIPT" \
    "$SERVICE_USER" "$BA_LOG" "$TARGET_DIR" "$ENV_PATH" || fail "systemd service install failed"
  ok "systemd service installed: pbox-${PLIST_LABEL##*.}"
fi

step 4 "Verifying"
if [[ "$DRY" == "1" ]]; then ok "Dry-run: skip verify"; else
  sleep 2
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$BIND:$PORT/healthz" || echo 000)
  [[ "$HTTP" == "200" ]] && ok "Responding: HTTP $HTTP" || echo "[$MODULE_NAME] WARN: HTTP $HTTP (tail /tmp/${LOG_PREFIX:-pandoras-box}-browser-actions.log)"
fi
echo ""
echo "[$MODULE_NAME] PASS"
echo "  Set allowed domains in $TARGET_DIR/.env (BROWSER_ACTIONS_ALLOWLIST=) then restart the daemon."
exit 0
