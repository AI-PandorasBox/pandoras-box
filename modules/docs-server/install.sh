#!/usr/bin/env bash
# install.sh -- docs-server module installer
# Copies the runtime + plist template from this module's runtime/ into
# $INSTALL_PATH, fills the template from theme.conf, registers the
# LaunchDaemon, verifies HTTP response.
set -euo pipefail

MODULE_NAME="docs-server"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

# Module-runtime + module-config locations.
MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-docs-server.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.docs-server"
PLIST_PATH="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/${PLIST_LABEL}.plist"

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
DOCS_PORT="${DOCS_PORT:-8485}"
DOCS_BIND="${DOCS_BIND:-127.0.0.1}"
DOCS_ENV="$TARGET_DIR/.env"
if [[ -f "$DOCS_ENV" ]]; then
  ok ".env already present -- preserving operator overrides"
else
  sudo bash -c "cat > '$DOCS_ENV'" <<ENVEOF
# Pandoras Box docs-server
DOCS_PORT=$DOCS_PORT
DOCS_BIND=$DOCS_BIND
NODE_ENV=production
INSTALL_PATH=$INSTALL_PATH
ENVEOF
  sudo chmod 600 "$DOCS_ENV"
  ok "Wrote $DOCS_ENV (port=$DOCS_PORT bind=$DOCS_BIND)"
fi

# ----------------------------------------------------------------------------
step 4 "Generating + installing LaunchDaemon plist from template"
SERVICE_USER="${DOCS_SERVER_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.docs-server.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"

# Render template into /tmp, then install with sudo
RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
    -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
    -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
    "$PLIST_TMPL" > "$RENDERED"

# Validate XML before installing
if command -v plutil &>/dev/null; then
  plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"
fi

sudo cp "$RENDERED" "$PLIST_PATH"
sudo chown root:wheel "$PLIST_PATH"
sudo chmod 644 "$PLIST_PATH"
rm -f "$RENDERED"
ok "Installed: $PLIST_PATH"

# (Re)load the LaunchDaemon
if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
ok "LaunchDaemon loaded"

# ----------------------------------------------------------------------------
step 5 "Verifying HTTP response"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$DOCS_BIND:$DOCS_PORT/" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Service responding: HTTP $HTTP on http://$DOCS_BIND:$DOCS_PORT/"
else
  echo "[$MODULE_NAME] WARN: Service registered but did not respond (HTTP $HTTP)."
  echo "  Check: tail -50 /tmp/${LOG_PREFIX}-docs-server.log"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Documentation server: http://$DOCS_BIND:$DOCS_PORT"
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "")
if [[ -n "$LOCAL_IP" && "$DOCS_BIND" == "0.0.0.0" ]]; then
  echo "  LAN URL:            http://$LOCAL_IP:$DOCS_PORT"
fi
exit 0
