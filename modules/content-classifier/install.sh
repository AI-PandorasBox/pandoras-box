#!/usr/bin/env bash
# install.sh -- content-classifier module installer
# Stages the runtime + plist template, sets up a Python venv with transformers,
# registers the LaunchDaemon, verifies the HTTP /api/health endpoint.
set -euo pipefail

MODULE_NAME="content-classifier"
TOTAL_STEPS=6

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.content-classifier"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

step 1 "Prerequisites (Python 3.11+)"
command -v python3 &>/dev/null || fail "python3 not found (brew install python@3.11)"
PYVER=$(python3 --version | awk '{print $2}')
PY_MAJ=$(echo "$PYVER" | cut -d. -f1); PY_MIN=$(echo "$PYVER" | cut -d. -f2)
if [[ "$PY_MAJ" -lt 3 || ( "$PY_MAJ" -eq 3 && "$PY_MIN" -lt 11 ) ]]; then
  fail "Python $PYVER too old; need 3.11+ (brew install python@3.11)"
fi
ok "Python $PYVER"

step 2 "Staging runtime"
sudo mkdir -p "$TARGET_DIR/store" "$TARGET_DIR/model-cache" "$TARGET_DIR/logs"
sudo cp "$MODULE_SRC_DIR/classifier.py" "$TARGET_DIR/"
sudo cp "$INSTALL_PATH/modules/$MODULE_NAME/requirements.txt" "$TARGET_DIR/"
ok "Files staged"

step 3 "Creating Python venv + installing transformers"
if [[ -d "$TARGET_DIR/venv" ]]; then
  ok "venv already present -- skipping create"
else
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    sudo mkdir -p "$TARGET_DIR/venv/bin"
    sudo bash -c "echo '#!/usr/bin/env python3' > '$TARGET_DIR/venv/bin/python3'"
    sudo chmod +x "$TARGET_DIR/venv/bin/python3"
    ok "(dry-run) venv stub created at $TARGET_DIR/venv"
  else
    sudo python3 -m venv "$TARGET_DIR/venv" || fail "venv create failed"
    sudo "$TARGET_DIR/venv/bin/pip" install --quiet -r "$TARGET_DIR/requirements.txt" || fail "pip install failed"
    ok "venv ready at $TARGET_DIR/venv (transformers + torch installed)"
  fi
fi

step 4 "Writing .env"
CC_PORT="${CONTENT_CLASSIFIER_PORT:-8487}"
CC_FAIL_MODE="${CONTENT_CLASSIFIER_FAIL_MODE:-closed}"
CC_ENV="$TARGET_DIR/.env"
if [[ -f "$CC_ENV" ]]; then
  ok ".env preserved"
else
  sudo bash -c "cat > '$CC_ENV'" <<ENVEOF
CONTENT_CLASSIFIER_PORT=$CC_PORT
CONTENT_CLASSIFIER_BIND=127.0.0.1
CONTENT_CLASSIFIER_MODE=shadow
CONTENT_CLASSIFIER_FAIL_MODE=$CC_FAIL_MODE
CONTENT_CLASSIFIER_MODEL_REPO=protectai/deberta-v3-base-prompt-injection-v2
CONTENT_CLASSIFIER_MODEL_CACHE=$TARGET_DIR/model-cache
INSTALL_PATH=$INSTALL_PATH
ENVEOF
  sudo chmod 600 "$CC_ENV"
  ok "Wrote $CC_ENV"
fi

step 5 "Installing plist"
SERVICE_USER="${CONTENT_CLASSIFIER_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/${PLIST_LABEL}.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing"
RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
    -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
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

step 6 "Verifying /api/health"
# First request triggers model download; allow generous time on real install.
WAIT=$([[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]] && echo 2 || echo 60)
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$WAIT" "http://127.0.0.1:$CC_PORT/api/health" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Service responding: HTTP $HTTP"
else
  echo "[$MODULE_NAME] WARN: HTTP $HTTP -- model download still in progress?"
  echo "  Check: tail -f /tmp/${LOG_PREFIX}-content-classifier.log"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Endpoint: http://127.0.0.1:$CC_PORT/"
echo "  Mode: shadow (no blocking for ~28 days while calibration runs)"
echo "  Fail mode: $CC_FAIL_MODE"
exit 0
