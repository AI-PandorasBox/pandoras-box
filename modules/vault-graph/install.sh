#!/usr/bin/env bash
# install.sh -- vault-graph installer. LaunchDaemon, renders memory -> Obsidian vault.
set -euo pipefail
MODULE_NAME="vault-graph"
TOTAL_STEPS=4
[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }
DRY_RUN_ACTIVE="${PBOX_DRY_RUN_ACTIVE:-${PBOX_DRY_RUN:-0}}"
MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-vault-graph.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.vault-graph"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH"
NODE_BIN=$(command -v node); ok "Node.js at $NODE_BIN"
[[ -d "$MODULE_SRC_DIR" ]] || fail "runtime dir missing at $MODULE_SRC_DIR"

step 2 "Staging runtime + vault dir + .env"
sudo mkdir -p "$TARGET_DIR/vault/Threads"
sudo chown -R "$(stat -f '%Su' "$INSTALL_PATH")" "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
ENV_PATH="$TARGET_DIR/.env"
if [[ -f "$ENV_PATH" ]]; then ok ".env preserved"; else
  sudo bash -c "cat > '$ENV_PATH'" <<ENVEOF
INSTALL_PATH=$INSTALL_PATH
VAULT_GRAPH_INTERVAL_SEC=600
SYSTEM_NAME=${SYSTEM_NAME:-Pandoras Box}
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$ENV_PATH"; ok "Wrote $ENV_PATH"
fi

step 3 "Rendering + loading LaunchDaemon"
SERVICE_USER="${VAULT_GRAPH_USER:-$(stat -f '%Su' "$INSTALL_PATH")}"
PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.vault-graph.plist.template"
[[ -f "$PLIST_TMPL" ]] || fail "plist template missing"
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
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then ok "Dry-run: skip verify"; else
  sleep 1; launchctl list | grep -q "$PLIST_LABEL" && ok "Registered" || echo "[$MODULE_NAME] WARN: not registered"
fi
echo ""
echo "[$MODULE_NAME] PASS"
echo "  Open in Obsidian: $TARGET_DIR/vault/"
exit 0
