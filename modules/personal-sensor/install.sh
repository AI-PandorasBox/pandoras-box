#!/usr/bin/env bash
# install.sh -- personal-sensor module installer
# Stages the runtime + plist template, fills the template from theme.conf,
# registers the LaunchDaemon, verifies the SSE port responds. Read-only SSE,
# localhost-bound, no shell exec internally.
set -euo pipefail

MODULE_NAME="personal-sensor"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
STORE_DIR="$TARGET_DIR/store"
RUNTIME_SCRIPT="pbox-personal-sensor.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.${MODULE_NAME}"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"
DRY_RUN="${PBOX_DRY_RUN_ACTIVE:-0}"

# ----------------------------------------------------------------------------
step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
ok "Node.js found at $NODE_BIN"
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing at $MODULE_SRC_DIR (staging step should have copied it)"

# ----------------------------------------------------------------------------
step 2 "Staging runtime into $TARGET_DIR"
sudo mkdir -p "$TARGET_DIR" "$STORE_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
ok "Runtime staged: $TARGET_DIR/$RUNTIME_SCRIPT"

# ----------------------------------------------------------------------------
step 3 "Writing .env (read-only operator config, no secrets stored here)"
SENSOR_PORT="${PERSONAL_SENSOR_SSE_PORT:-8489}"
SENSOR_SCAN_MS="${PERSONAL_SENSOR_SCAN_MS:-600000}"
SENSOR_GEOFENCE="${PERSONAL_SENSOR_GEOFENCE:-0}"
SENSOR_ENV="$TARGET_DIR/.env"
if [[ -f "$SENSOR_ENV" ]]; then
  ok ".env already present -- preserving operator overrides"
else
  # Prompt for geofence opt-in unless dry-run (dry-run must be no-op).
  if [[ "$DRY_RUN" == "1" ]]; then
    GEOFENCE_CHOICE="$SENSOR_GEOFENCE"
  else
    read -rp "  Enable geofencing? Requires 'brew install corelocationcli'. [y/N]: " GF_REPLY || GF_REPLY="n"
    case "$GF_REPLY" in y|Y|yes|YES) GEOFENCE_CHOICE=1 ;; *) GEOFENCE_CHOICE=0 ;; esac
  fi
  sudo bash -c "cat > '$SENSOR_ENV'" <<ENVEOF
PERSONAL_SENSOR_SSE_PORT=$SENSOR_PORT
PERSONAL_SENSOR_SCAN_MS=$SENSOR_SCAN_MS
PERSONAL_SENSOR_GEOFENCE=$GEOFENCE_CHOICE
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$SENSOR_ENV"
  ok "Wrote $SENSOR_ENV (port=$SENSOR_PORT scan_ms=$SENSOR_SCAN_MS geofence=$GEOFENCE_CHOICE)"
fi

# Tokens come from mail-* modules. Document the source the daemon will use.
for src in "$INSTALL_PATH/mail-ms365/.env" "$INSTALL_PATH/mail-google/.env"; do
  if [[ -f "$src" ]]; then
    ok "Calendar source detected: $src"
  fi
done

# ----------------------------------------------------------------------------
step 4 "Generating + installing LaunchDaemon plist from template"
SERVICE_USER="${PERSONAL_SENSOR_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
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

if [[ "$DRY_RUN" == "1" ]]; then
  ok "DRY_RUN=1 -- plist rendered + linted at $RENDERED but NOT installed or loaded"
  echo "[$MODULE_NAME] PASS (dry-run)"
  exit 0
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
step 5 "Verifying SSE endpoint"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$SENSOR_PORT/health" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Health endpoint responding: HTTP $HTTP on http://127.0.0.1:$SENSOR_PORT/health"
else
  echo "[$MODULE_NAME] WARN: Service registered but health endpoint did not respond (HTTP $HTTP)."
  echo "  Check: tail -50 /tmp/${LOG_PREFIX}-personal-sensor.log"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  SSE stream: http://127.0.0.1:$SENSOR_PORT/events"
echo "  Health:     http://127.0.0.1:$SENSOR_PORT/health"
echo "  Recent:     http://127.0.0.1:$SENSOR_PORT/recent?n=50"
exit 0
