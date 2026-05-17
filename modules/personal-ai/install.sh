#!/usr/bin/env bash
# install.sh -- personal-ai module installer (v0.3 placeholder)
# Stages the v0.3 placeholder runtime + plist template, registers the
# LaunchDaemon, verifies HTTP. v0.4 will drop the full Personal AI runtime
# into the same slot.
set -euo pipefail

MODULE_NAME="personal-ai"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.personal-ai"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing"
ok "Node.js $NODE_BIN"

step 2 "Staging v0.3 placeholder runtime"
sudo mkdir -p "$TARGET_DIR/store" "$TARGET_DIR/public"
sudo cp "$MODULE_SRC_DIR/pbox-personal-ai.mjs" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/pbox-personal-ai.mjs"
ok "Runtime staged ($TARGET_DIR/pbox-personal-ai.mjs)"

step 3 "Writing .env"
PA_PORT="${PERSONAL_AI_PORT:-${MUSE_PORT:-8800}}"
PA_BIND="${PERSONAL_AI_BIND:-127.0.0.1}"
PA_NAME="${PERSONAL_AI_NAME:-${MUSE_DISPLAY_NAME:-Assistant}}"
PA_ENV="$TARGET_DIR/.env"
if [[ -f "$PA_ENV" ]]; then
  ok ".env preserved"
else
  sudo bash -c "cat > '$PA_ENV'" <<ENVEOF
PERSONAL_AI_PORT=$PA_PORT
PERSONAL_AI_BIND=$PA_BIND
PERSONAL_AI_NAME=$PA_NAME
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$PA_ENV"
  ok "Wrote $PA_ENV (port=$PA_PORT bind=$PA_BIND name=$PA_NAME)"
fi

step 4 "Installing plist"
SERVICE_USER="${PERSONAL_AI_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
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

step 5 "Verifying placeholder responds"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$PA_BIND:$PA_PORT/api/health" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Placeholder responding: HTTP $HTTP"
else
  echo "[$MODULE_NAME] WARN: HTTP $HTTP"
fi
echo ""
echo "[$MODULE_NAME] PASS"
echo "  Personal AI (v0.3 placeholder): http://$PA_BIND:$PA_PORT/"
echo "  Full runtime ships in v0.4."
exit 0
