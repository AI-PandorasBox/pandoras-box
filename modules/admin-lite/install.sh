#!/usr/bin/env bash
set -euo pipefail
MODULE_NAME="admin-lite"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.admin-lite"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH"
NODE_BIN=$(command -v node)
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing"
ok "Node.js $NODE_BIN"

step 2 "Staging runtime"
sudo mkdir -p "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/pbox-admin-lite.mjs" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/pbox-admin-lite.mjs"
ok "Runtime staged"

step 3 "Generating PIN + .env"
AL_PORT="${ADMIN_LITE_PORT:-8488}"
AL_BIND="${ADMIN_LITE_BIND:-127.0.0.1}"
AL_ENV="$TARGET_DIR/.env"
if [[ -f "$AL_ENV" ]]; then
  ok ".env preserved (delete to regenerate PIN)"
else
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    PIN="123456"
  else
    while true; do
      read -srp "  Choose a 4-12 digit PIN: " PIN; echo ""
      [[ "$PIN" =~ ^[0-9]{4,12}$ ]] && break || echo "  PIN must be 4-12 digits"
    done
  fi
  SALT=$(openssl rand -hex 16)
  HASH=$("$NODE_BIN" -e "const c=require('crypto'); process.stdout.write(c.pbkdf2Sync('$PIN','$SALT',200000,32,'sha256').toString('hex'))")
  sudo bash -c "cat > '$AL_ENV'" <<ENVEOF
ADMIN_LITE_PORT=$AL_PORT
ADMIN_LITE_BIND=$AL_BIND
ADMIN_LITE_PIN_HASH=$SALT:$HASH
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$AL_ENV"
  ok "Wrote $AL_ENV"
fi

step 4 "Installing plist"
SERVICE_USER="${ADMIN_LITE_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/${PLIST_LABEL}.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing"
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
ok "Plist installed + loaded"

step 5 "Verifying"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$AL_BIND:$AL_PORT/" || echo "000")
[[ "$HTTP" == "200" ]] && ok "Service responding: HTTP $HTTP" || echo "[$MODULE_NAME] WARN: HTTP $HTTP"
echo ""
echo "[$MODULE_NAME] PASS"
echo "  Admin Lite:  http://$AL_BIND:$AL_PORT"
exit 0
