#!/usr/bin/env bash
set -euo pipefail
MODULE_NAME="terminal"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-terminal.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.terminal"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH"
NODE_BIN=$(command -v node)
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing"
ok "Node.js $NODE_BIN"

step 2 "Staging runtime"
sudo mkdir -p "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
ok "Runtime staged"

step 3 "Generating passphrase + .env"
TERM_PORT="${TERMINAL_PORT:-8484}"
TERM_BIND="${TERMINAL_BIND:-127.0.0.1}"
TERM_ENV="$TARGET_DIR/.env"
if [[ -f "$TERM_ENV" ]]; then
  ok ".env preserved (delete to regenerate passphrase)"
else
  # Prompt for passphrase (skipped in dry-run by parent setup function)
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    PASS="dryrun-placeholder"
  else
    read -srp "  Choose a terminal passphrase (won't be shown): " PASS; echo ""
    [[ -z "$PASS" ]] && fail "Empty passphrase"
  fi
  SALT=$(openssl rand -hex 16)
  HASH=$("$NODE_BIN" -e "const c=require('crypto'); process.stdout.write(c.pbkdf2Sync('$PASS','$SALT',200000,32,'sha256').toString('hex'))")
  sudo bash -c "cat > '$TERM_ENV'" <<ENVEOF
TERMINAL_PORT=$TERM_PORT
TERMINAL_BIND=$TERM_BIND
TERMINAL_PASSPHRASE_HASH=$SALT:$HASH
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$TERM_ENV"
  ok "Wrote $TERM_ENV (PBKDF2 200k iterations, sha256, 16-byte salt)"
fi

step 4 "Generating + installing LaunchDaemon plist"
SERVICE_USER="${TERMINAL_USER:-$(pbox_stat_owner "$INSTALL_PATH")}"
if [[ "$PBOX_OS" == Darwin ]]; then
  PLIST_TMPL="$MODULE_SRC_DIR/${PLIST_LABEL}.plist.template"
  [[ -f "$PLIST_TMPL" ]] || fail "plist template missing"
  RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
  sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
      -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
      -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
      -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
      -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
      "$PLIST_TMPL" > "$RENDERED"
  plutil -lint "$RENDERED" >/dev/null || fail "rendered plist invalid"
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
else
  TERM_LOG="/tmp/${LOG_PREFIX}-terminal.log"
  pbox_create_service "$PLIST_LABEL" "$NODE_BIN" "$TARGET_DIR/$RUNTIME_SCRIPT" \
    "$SERVICE_USER" "$TERM_LOG" "$TARGET_DIR" "$TERM_ENV" || fail "systemd service install failed"
  ok "systemd service installed: pbox-${PLIST_LABEL##*.}"
fi

step 5 "Verifying HTTP response"
sleep 2
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$TERM_BIND:$TERM_PORT/" || echo "000")
if [[ "$HTTP" == "200" ]]; then
  ok "Service responding: HTTP $HTTP"
else
  echo "[$MODULE_NAME] WARN: Service registered but HTTP $HTTP"
fi
echo ""
echo "[$MODULE_NAME] PASS"
echo "  Terminal:  http://$TERM_BIND:$TERM_PORT"
exit 0
