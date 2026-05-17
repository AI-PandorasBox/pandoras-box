#!/usr/bin/env bash
# install.sh -- media-production background queue worker installer
# Stages runtime + plist template into $INSTALL_PATH, fills the template
# from theme.conf, registers the LaunchDaemon. PBOX_DRY_RUN=1 stops before
# any launchctl call and performs no API key validation.
set -euo pipefail

MODULE_NAME="media-production"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-media-production.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.media-production"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

DRY_RUN="${PBOX_DRY_RUN:-0}"

# -----------------------------------------------------------------------------
step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
[[ "$NODE_MAJOR" -ge 22 ]] || fail "Node 22+ required (have $(node -v))"
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing at $MODULE_SRC_DIR"
ok "Node $(node -v) at $NODE_BIN"

# -----------------------------------------------------------------------------
step 2 "Staging runtime"
sudo mkdir -p "$TARGET_DIR" "$TARGET_DIR/store/queue" "$TARGET_DIR/output"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
sudo chmod 750 "$TARGET_DIR/store/queue" "$TARGET_DIR/output"
ok "Runtime staged at $TARGET_DIR/$RUNTIME_SCRIPT"

# -----------------------------------------------------------------------------
step 3 "Writing .env"
MEDIA_ENV="$TARGET_DIR/.env"
PORT_VAL="${MEDIA_PRODUCTION_PORT:-8486}"
BIND_VAL="${MEDIA_PRODUCTION_BIND:-127.0.0.1}"
HTTP_VAL="${MEDIA_PRODUCTION_HTTP:-0}"
if [[ -f "$MEDIA_ENV" ]]; then
  ok ".env preserved (delete to regenerate)"
else
  # Keys are intentionally blank by default; operator must edit .env.
  # The worker reports a clear failure on each missing key per job kind.
  sudo bash -c "cat > '$MEDIA_ENV'" <<ENVEOF
# Pandoras Box media-production
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
MEDIA_PRODUCTION_HTTP=$HTTP_VAL
MEDIA_PRODUCTION_PORT=$PORT_VAL
MEDIA_PRODUCTION_BIND=$BIND_VAL
MEDIA_PRODUCTION_QUEUE_DIR=$TARGET_DIR/store/queue
MEDIA_PRODUCTION_OUTPUT_DIR=$TARGET_DIR/output
MEDIA_PRODUCTION_POLL_MS=30000

# Backend API keys (fill in to enable the corresponding job kind)
SUNO_API_KEY=
ELEVENLABS_API_KEY=
MEDIA_NARRATION_VOICE_ID=
GOOGLE_AI_KEY=
ENVEOF
  sudo chmod 600 "$MEDIA_ENV"
  ok "Wrote $MEDIA_ENV (operator must fill in API keys)"
fi

# -----------------------------------------------------------------------------
step 4 "Generating + installing LaunchDaemon plist"
SERVICE_USER="${MEDIA_PRODUCTION_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.media-production.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"
RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
    -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
    -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
    "$PLIST_TMPL" > "$RENDERED"
plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"

# Ownership of files written by the daemon must match the service user.
sudo chown -R "$SERVICE_USER" "$TARGET_DIR/store" "$TARGET_DIR/output" 2>/dev/null || true

if [[ "$DRY_RUN" == "1" ]]; then
  ok "[DRY-RUN] plist rendered + validated at $RENDERED -- not installed"
  echo "[$MODULE_NAME] PASS (dry-run)"
  exit 0
fi

sudo mkdir -p "$PLIST_DIR"
sudo cp "$RENDERED" "$PLIST_PATH"
sudo chown root:wheel "$PLIST_PATH"
sudo chmod 644 "$PLIST_PATH"
rm -f "$RENDERED"
ok "Plist installed: $PLIST_PATH"

if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
  sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
ok "LaunchDaemon loaded"

# -----------------------------------------------------------------------------
step 5 "Verifying daemon"
sleep 2
if [[ "$HTTP_VAL" == "1" ]]; then
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$BIND_VAL:$PORT_VAL/api/health" || echo "000")
  if [[ "$HTTP" == "200" ]]; then
    ok "HTTP surface responding: $HTTP on http://$BIND_VAL:$PORT_VAL/api/health"
  else
    echo "[$MODULE_NAME] WARN: HTTP enabled but health check returned $HTTP"
    echo "  Check: tail -50 /tmp/${LOG_PREFIX}-media-production.log"
  fi
else
  # No HTTP surface; confirm the daemon is registered + running.
  if launchctl list | grep -q "$PLIST_LABEL"; then
    ok "Daemon registered ($PLIST_LABEL)"
  else
    echo "[$MODULE_NAME] WARN: daemon not visible in launchctl list"
  fi
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Queue dir:  $TARGET_DIR/store/queue"
echo "  Output dir: $TARGET_DIR/output"
echo "  Log:        /tmp/${LOG_PREFIX}-media-production.log"
if [[ "$HTTP_VAL" == "1" ]]; then
  echo "  HTTP:       http://$BIND_VAL:$PORT_VAL"
fi
exit 0
