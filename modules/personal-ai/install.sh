#!/usr/bin/env bash
# install.sh -- personal-ai module installer.
# Stages the runtime + plist template into $INSTALL_PATH, prompts for the
# operator passphrase, fills the template from theme.conf, registers the
# LaunchDaemon, verifies HTTP response.
set -euo pipefail

MODULE_NAME="personal-ai"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
RUNTIME_SCRIPT="pbox-personal-ai.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.personal-ai"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

# ----------------------------------------------------------------------------
step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
[[ "$NODE_MAJOR" -ge 22 ]] || fail "Node.js >= 22 required (got $NODE_MAJOR) for node:sqlite + fetch"
[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing at $MODULE_SRC_DIR"
[[ -f "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" ]] || fail "Runtime script missing"
[[ -d "$MODULE_SRC_DIR/public" ]] || fail "public/ assets missing"
ok "Node.js $NODE_BIN (v$NODE_MAJOR)"

# ----------------------------------------------------------------------------
step 2 "Staging runtime into $TARGET_DIR"
sudo mkdir -p "$TARGET_DIR" "$TARGET_DIR/store" "$TARGET_DIR/store/sessions" "$TARGET_DIR/public"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo cp "$MODULE_SRC_DIR/public/index.html" "$TARGET_DIR/public/"
sudo cp "$MODULE_SRC_DIR/public/app.js"    "$TARGET_DIR/public/"
sudo cp "$MODULE_SRC_DIR/public/style.css" "$TARGET_DIR/public/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"
sudo chmod 644 "$TARGET_DIR/public/index.html" "$TARGET_DIR/public/app.js" "$TARGET_DIR/public/style.css"

# npm install the only allowed runtime dep (Anthropic SDK)
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" != "1" ]]; then
  if [[ ! -d "$TARGET_DIR/node_modules/@anthropic-ai/sdk" ]]; then
    if command -v npm &>/dev/null; then
      pushd "$TARGET_DIR" >/dev/null
      sudo npm init -y >/dev/null 2>&1 || true
      sudo npm install @anthropic-ai/sdk --omit=dev --no-audit --no-fund >/dev/null
      popd >/dev/null
      ok "Installed @anthropic-ai/sdk"
    else
      echo "[$MODULE_NAME] WARN: npm not on PATH; @anthropic-ai/sdk not installed."
      echo "  Install manually: (cd $TARGET_DIR && npm install @anthropic-ai/sdk)"
    fi
  else
    ok "@anthropic-ai/sdk already present"
  fi
else
  ok "DRY_RUN: skipped npm install"
fi
ok "Runtime + public assets staged"

# ----------------------------------------------------------------------------
step 3 "Writing .env"
PA_PORT="${PERSONAL_AI_PORT:-8800}"
PA_BIND="${PERSONAL_AI_BIND:-127.0.0.1}"
PA_NAME="${PERSONAL_AI_NAME:-Assistant}"
PA_MODEL="${PERSONAL_AI_MODEL:-claude-sonnet-4-6}"
PA_VOICE="${PERSONAL_AI_VOICE:-0}"
PA_TAILSCALE_ONLY="${PERSONAL_AI_TAILSCALE_ONLY:-0}"
PA_ENV="$TARGET_DIR/.env"

# Prompts (allow overrides via env; skip in dry-run)
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" != "1" && -t 0 && -t 1 ]]; then
  if [[ "${PERSONAL_AI_PORT:-}" == "" ]]; then
    read -rp "  Personal AI port [$PA_PORT]: " ans; [[ -n "$ans" ]] && PA_PORT="$ans"
  fi
  if [[ "${PERSONAL_AI_VOICE:-}" == "" ]]; then
    read -rp "  Enable voice (Web Speech, browser-side STT) [y/N]: " ans
    ans_lc=$(printf '%s' "$ans" | tr 'A-Z' 'a-z')
    [[ "$ans_lc" == "y" || "$ans_lc" == "yes" ]] && PA_VOICE="1"
  fi
fi

if [[ -f "$PA_ENV" ]]; then
  ok ".env preserved (delete to regenerate passphrase)"
else
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    PASS="dryrun-placeholder"
  elif [[ "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" || ! -t 0 || ! -t 1 ]]; then
    # _UNATTENDED_PASSPHRASE_2026-05-30 -- non-interactive install has no TTY to prompt
    # on. Previously this fell through to `read`, got an empty value, and `fail`ed the
    # whole Personal Assistant module. Use a known placeholder (override with
    # PERSONAL_AI_PASSPHRASE) so the module installs headless; user changes it later.
    PASS="${PERSONAL_AI_PASSPHRASE:-${PBOX_UNATTENDED_PLACEHOLDER:-unattended-placeholder}}"
    ok "[unattended] Personal Assistant passphrase set to a placeholder -- change it after first login."
  else
    read -srp "  Choose a passphrase for $PA_NAME (won't be shown): " PASS; echo ""
    [[ -z "$PASS" ]] && fail "Empty passphrase"
    read -srp "  Confirm passphrase: " PASS2; echo ""
    [[ "$PASS" != "$PASS2" ]] && fail "Passphrases did not match"
  fi
  SALT=$(openssl rand -hex 16)
  HASH=$(P="$PASS" S="$SALT" "$NODE_BIN" -e "const c=require('crypto'); process.stdout.write(c.pbkdf2Sync(process.env.P, process.env.S, 200000, 32, 'sha256').toString('hex'))")
  unset PASS PASS2
  sudo bash -c "cat > '$PA_ENV'" <<ENVEOF
PERSONAL_AI_PORT=$PA_PORT
PERSONAL_AI_BIND=$PA_BIND
PERSONAL_AI_NAME=$PA_NAME
PERSONAL_AI_MODEL=$PA_MODEL
PERSONAL_AI_VOICE=$PA_VOICE
PERSONAL_AI_TAILSCALE_ONLY=$PA_TAILSCALE_ONLY
PERSONAL_AI_PASSPHRASE_HASH=$SALT:$HASH
INSTALL_PATH=$INSTALL_PATH
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$PA_ENV"
  ok "Wrote $PA_ENV (PBKDF2 200k iterations, sha256, 16-byte salt)"
fi

# ----------------------------------------------------------------------------
step 4 "Generating + installing LaunchDaemon plist from template"
SERVICE_USER="${PERSONAL_AI_USER:-$(pbox_stat_owner "$INSTALL_PATH")}"
if [[ "$PBOX_OS" == Darwin ]]; then
  PLIST_TMPL="$MODULE_SRC_DIR/${PLIST_LABEL}.plist.template"
  [[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"
  RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
  sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
      -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
      -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
      -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
      -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
      "$PLIST_TMPL" > "$RENDERED"
  plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"
  sudo mkdir -p "$PLIST_DIR"
  sudo cp "$RENDERED" "$PLIST_PATH"
  sudo chown root:wheel "$PLIST_PATH"
  sudo chmod 644 "$PLIST_PATH"
  rm -f "$RENDERED"
  ok "Plist installed: $PLIST_PATH"

  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    ok "DRY_RUN: skipped launchctl load"
  else
    if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
      sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
    fi
    sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
    ok "LaunchDaemon loaded"
  fi
else
  # Linux: systemd unit via the portability layer. The runtime reads its config
  # from .env in its WorkingDirectory; EnvironmentFile is belt-and-braces.
  PA_LOG="/tmp/${LOG_PREFIX}-personal-ai.log"
  pbox_create_service "$PLIST_LABEL" "$NODE_BIN" "$TARGET_DIR/$RUNTIME_SCRIPT" \
    "$SERVICE_USER" "$PA_LOG" "$TARGET_DIR" "$PA_ENV" || fail "systemd service install failed"
  # CLI bridge: hand the service account the operator's Claude subscription creds
  # (no-op in API-key mode), then restart so the runtime picks them up.
  pbox_distribute_claude_creds "pbox-${PLIST_LABEL##*.}" "$TARGET_DIR"
  sudo systemctl restart "pbox-${PLIST_LABEL##*.}" 2>/dev/null || true
  ok "systemd service installed: pbox-${PLIST_LABEL##*.}"
fi

# ----------------------------------------------------------------------------
step 5 "Verifying HTTP response"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "DRY_RUN: skipped HTTP probe"
else
  sleep 2
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$PA_BIND:$PA_PORT/api/health" || echo "000")
  if [[ "$HTTP" == "200" ]]; then
    ok "Service responding: HTTP $HTTP on http://$PA_BIND:$PA_PORT/"
  else
    echo "[$MODULE_NAME] WARN: Service registered but did not respond (HTTP $HTTP)."
    echo "  Check: tail -50 /tmp/${LOG_PREFIX}-personal-ai.log"
  fi
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Personal AI: http://$PA_BIND:$PA_PORT/"
echo "  Sign in with the passphrase you set."
exit 0
