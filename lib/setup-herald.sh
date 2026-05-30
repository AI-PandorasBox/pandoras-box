# =============================================================================
# setup-herald.sh -- Herald: connect Telegram to the Personal Assistant.
# Walks the user through BotFather, captures the bot token + their chat id,
# installs the Herald relay daemon, and wires it to the assistant so they can
# chat with it from Telegram on any device. _HERALD_2026-05-30
# =============================================================================

run_herald_setup() {
  print_module_info_card \
    "Telegram (Herald)" \
    "Talk to your assistant from Telegram on your phone. Herald is a small relay that bridges a free Telegram bot to your assistant. You create a bot via @BotFather, paste its token, and Herald does the rest -- your assistant replies right in Telegram." \
    "Nothing." \
    "Free." \
    "~5 minutes"

  # Telegram needs a real bot token, so a headless/dry-run install skips it cleanly.
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[unattended] Skipping Telegram/Herald (needs a real bot token). Set it up later with:"
    info_msg "    sudo bash ${INSTALL_PATH:-/opt/pandoras-box}/lib/setup-herald.sh && run_herald_setup"
    return 0
  fi

  prompt_yes_no "Set up Telegram (Herald) so you can chat with your assistant from your phone?" h_choice "yes"
  if [[ "$h_choice" != "yes" ]]; then
    info_msg "Skipping Telegram/Herald. You can set it up later."
    return 0
  fi

  echo ""
  echo "  ${C_BOLD:-}Step 1 of 3 -- Create your bot in Telegram${C_RESET:-}"
  echo "    1. Open Telegram and search for  @BotFather"
  echo "    2. Send  /newbot  and follow the prompts (a name, then a username ending in 'bot')"
  echo "    3. BotFather replies with a token like  123456789:AAH...xyz"
  echo ""
  local token=""
  while [[ -z "$token" ]]; do
    read -rsp "  Paste the bot token from BotFather (hidden): " token; echo ""
    [[ "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || { warn_msg "That does not look like a token (should be 123456789:AA...). Try again."; token=""; }
  done

  echo ""
  echo "  ${C_BOLD:-}Step 2 of 3 -- Lock it to your chat (recommended)${C_RESET:-}"
  echo "    1. In Telegram, open your new bot and send it any message (e.g. 'hi')"
  echo "    2. Then run (Enter to skip and allow any chat):"
  echo "         curl -s \"https://api.telegram.org/bot${token}/getUpdates\""
  echo "       Your numeric chat id is the \"id\" under \"chat\"."
  echo ""
  local chat_id=""
  read -rp "  Allowed chat id (Enter to allow any chat -- not recommended): " chat_id

  echo ""
  echo "  ${C_BOLD:-}Step 3 of 3 -- Installing Herald${C_RESET:-}"

  local PA_DIR="${INSTALL_PATH}/personal-ai"
  local PA_ENV="${PA_DIR}/.env"
  local HERALD_SRC="${INSTALL_PATH}/modules/personal-ai/runtime/pbox-herald.mjs"
  [[ -f "$HERALD_SRC" ]] || HERALD_SRC="${SETUP_DIR}/modules/personal-ai/runtime/pbox-herald.mjs"
  [[ -f "$HERALD_SRC" ]] || { error_msg "Herald runtime not found"; return 1; }
  [[ -f "$PA_ENV" ]] || { error_msg "Personal Assistant not installed -- set it up first."; return 1; }

  local secret; secret=$(openssl rand -hex 24)

  sudo cp "$HERALD_SRC" "$PA_DIR/pbox-herald.mjs"
  sudo chmod 755 "$PA_DIR/pbox-herald.mjs"
  local H_ENV="$PA_DIR/herald.env"
  sudo bash -c "cat > '$H_ENV'" <<HEOF
TELEGRAM_BOT_TOKEN=$token
TELEGRAM_CHAT_ID=$chat_id
HERALD_SECRET=$secret
PERSONAL_AI_URL=http://127.0.0.1:${PERSONAL_AI_PORT:-8800}
HEOF
  sudo chmod 600 "$H_ENV"

  # Teach the assistant the same secret so it accepts relayed messages.
  if sudo grep -q '^HERALD_SECRET=' "$PA_ENV" 2>/dev/null; then
    sudo sed -i "s|^HERALD_SECRET=.*|HERALD_SECRET=$secret|" "$PA_ENV"
  else
    echo "HERALD_SECRET=$secret" | sudo tee -a "$PA_ENV" >/dev/null
  fi

  local NODE_BIN; NODE_BIN=$(command -v node)
  pbox_create_service "${LAUNCHDAEMON_PREFIX}.herald" "$NODE_BIN" "$PA_DIR/pbox-herald.mjs" \
    "$(id -un)" "/tmp/pandoras-box-herald.log" "$PA_DIR" "$H_ENV" \
    || { error_msg "Herald service install failed"; return 1; }

  # Restart the assistant so it picks up HERALD_SECRET.
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.personal-ai" 2>/dev/null || true

  check_pass "Herald installed -- message your bot in Telegram to talk to your assistant."
  [[ -z "$chat_id" ]] && warn_msg "No allowed chat id set -- the bot will respond to anyone who finds it."
}
