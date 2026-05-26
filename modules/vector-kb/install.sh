#!/usr/bin/env bash
# install.sh -- vector-kb module installer.
# Local semantic-memory service: embeds text via Ollama, stores vectors in
# SQLite, answers nearest-neighbour search. Localhost-only LaunchDaemon.
set -euo pipefail

MODULE_NAME="vector-kb"
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
RUNTIME_SCRIPT="pbox-vector-kb.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.vector-kb"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"
VECTOR_KB_PORT="${VECTOR_KB_PORT:-8486}"
VECTOR_KB_BIND="${VECTOR_KB_BIND:-127.0.0.1}"
VECTOR_KB_MODEL="${VECTOR_KB_MODEL:-nomic-embed-text}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
ok "Node.js at $NODE_BIN"
[[ -d "$MODULE_SRC_DIR" ]] || fail "runtime dir missing at $MODULE_SRC_DIR"
# Ollama is a soft dependency: the service runs without it, but ingest/search
# need a local embedding model. Warn, do not fail.
if curl -s -o /dev/null --max-time 3 "$OLLAMA_URL/api/tags" 2>/dev/null; then
  ok "Ollama reachable at $OLLAMA_URL"
  if ! curl -s --max-time 3 "$OLLAMA_URL/api/tags" 2>/dev/null | grep -q "$VECTOR_KB_MODEL"; then
    echo "  NOTE: pull the embedding model first:  ollama pull $VECTOR_KB_MODEL"
  fi
else
  echo "  NOTE: Ollama not reachable. Install the 'ollama' module and run:  ollama pull $VECTOR_KB_MODEL"
fi

step 2 "Staging runtime + store + .env"
sudo mkdir -p "$TARGET_DIR" "$STORE_DIR"
sudo chown -R "$(stat -f '%Su' "$INSTALL_PATH")" "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
ENV_PATH="$TARGET_DIR/.env"
if [[ -f "$ENV_PATH" ]]; then
  ok ".env preserved"
else
  sudo bash -c "cat > '$ENV_PATH'" <<ENVEOF
VECTOR_KB_PORT=$VECTOR_KB_PORT
VECTOR_KB_BIND=$VECTOR_KB_BIND
VECTOR_KB_MODEL=$VECTOR_KB_MODEL
OLLAMA_URL=$OLLAMA_URL
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$ENV_PATH"
  ok "Wrote $ENV_PATH"
fi

step 3 "Rendering + loading LaunchDaemon"
SERVICE_USER="${VECTOR_KB_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.vector-kb.plist.template"
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

step 4 "Verifying HTTP response"
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ok "Dry-run: skipping HTTP verify"
else
  sleep 2
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$VECTOR_KB_BIND:$VECTOR_KB_PORT/healthz" || echo "000")
  [[ "$HTTP" == "200" ]] && ok "Responding: HTTP $HTTP" || echo "[$MODULE_NAME] WARN: registered but HTTP $HTTP (tail /tmp/${LOG_PREFIX:-pandoras-box}-vector-kb.log)"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Service:  http://$VECTOR_KB_BIND:$VECTOR_KB_PORT/  (POST /ingest, GET /search?q=)"
echo "  Import:   pbox-import --from obsidian --path <vault> --target kb"
exit 0
