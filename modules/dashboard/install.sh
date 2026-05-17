#!/usr/bin/env bash
# install.sh -- dashboard module installer
# Stages the runtime + plist template into $INSTALL_PATH, fills the template
# from theme.conf, registers the LaunchDaemon, verifies HTTP response.
set -euo pipefail

MODULE_NAME="dashboard"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-dashboard.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.dashboard"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

# ----------------------------------------------------------------------------
step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
ok "Node.js found at $NODE_BIN"
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing at $MODULE_SRC_DIR (staging step should have copied it)"

# ----------------------------------------------------------------------------
step 2 "Staging runtime into $TARGET_DIR"
sudo mkdir -p "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
ok "Runtime staged: $TARGET_DIR/$RUNTIME_SCRIPT"

# ----------------------------------------------------------------------------
step 3 "Writing .env"
DASH_PORT="${DASHBOARD_PORT:-8181}"
DASH_BIND="${DASHBOARD_BIND:-127.0.0.1}"
DASH_ENV="$TARGET_DIR/.env"
if [[ -f "$DASH_ENV" ]]; then
  ok ".env already present -- preserving operator overrides"
else
  sudo bash -c "cat > '$DASH_ENV'" <<ENVEOF
DASHBOARD_PORT=$DASH_PORT
DASHBOARD_BIND=$DASH_BIND
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$DASH_ENV"
  ok "Wrote $DASH_ENV (port=$DASH_PORT bind=$DASH_BIND)"
fi

# ----------------------------------------------------------------------------
step 4 "Generating + installing LaunchDaemon plist from template"
SERVICE_USER="${DASHBOARD_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/${PLIST_LABEL}.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"

RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
    -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
    -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
    "$PLIST_TMPL" > "$RENDERED"

if command -v plutil &>/dev/null; then
  plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"
fi

sudo mkdir -p "$PLIST_DIR"
sudo cp "$RENDERED" "$PLIST_PATH"
sudo chown root:wheel "$PLIST_PATH"
sudo chmod 644 "$PLIST_PATH"
rm -f "$RENDERED"
ok "Installed: $PLIST_PATH"

if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
ok "LaunchDaemon loaded"

# ----------------------------------------------------------------------------
step 5 "Verifying HTTP response"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$DASH_BIND:$DASH_PORT/" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Service responding: HTTP $HTTP on http://$DASH_BIND:$DASH_PORT/"
else
  echo "[$MODULE_NAME] WARN: Service registered but did not respond (HTTP $HTTP)."
  echo "  Check: tail -50 /tmp/${LOG_PREFIX}-dashboard.log"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Dashboard: http://$DASH_BIND:$DASH_PORT"
exit 0
