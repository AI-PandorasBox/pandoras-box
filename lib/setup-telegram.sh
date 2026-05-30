# =============================================================================
# setup-telegram.sh -- Per-company Telegram bot setup
# Walks the user through BotFather, then captures bot token + their personal
# Telegram chat ID, validates with a live test message.
# Called from setup-company.sh after the email/calendar tenant is configured.
# =============================================================================

# run_telegram_setup_for_company <slug> <display_name>
#   On success, exports TELEGRAM_BOT_TOKEN_<slug> and TELEGRAM_CHAT_ID_<slug>
#   On user-skip, exports them as empty strings (the company is then text-only
#   via the browser admin panel, not Telegram).
run_telegram_setup_for_company() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  local slug="$1"
  local display_name="$2"

  print_module_info_card \
    "Telegram bot for ${display_name}" \
    "Each company conductor has its own Telegram bot. You message your AI through Telegram, and the conductor classifies the request and routes it to the right task agent. Without Telegram, the conductor still works -- you can send commands through the browser admin panel -- but most users find Telegram simpler day-to-day." \
    "A Telegram account on your phone, plus 5 minutes to walk through BotFather (Telegram's bot-creation bot)." \
    "Free. Telegram does not charge for bot creation or messages." \
    "~5 minutes per company"

  prompt_yes_no "Set up a Telegram bot for ${display_name} now?" tg_choice "yes"
  if [[ "$tg_choice" != "yes" ]]; then
    info_msg "Skipping Telegram for ${display_name}. You can run this step later."
    eval "TELEGRAM_BOT_TOKEN_${slug}=\"\""
    eval "TELEGRAM_CHAT_ID_${slug}=\"\""
    return 0
  fi

  echo ""
  echo "  ${C_BOLD}Step 1 of 3 -- Create the bot in Telegram${C_RESET}"
  echo ""
  echo "  Open Telegram on your phone or desktop and:"
  echo ""
  echo "    1. Search for the user named ${C_BOLD}@BotFather${C_RESET}"
  echo "    2. Start a chat with BotFather"
  echo "    3. Send the message:  ${C_BOLD}/newbot${C_RESET}"
  echo "    4. When BotFather asks for a name, send something like:"
  echo "         ${display_name} Assistant"
  echo "       (this is the friendly name -- it can be anything)"
  echo "    5. When BotFather asks for a username, send something like:"
  echo "         ${slug}_assistant_bot"
  echo "       (this MUST end with 'bot' and must be unique on Telegram)"
  echo "    6. BotFather replies with a token that looks like:"
  echo "         123456789:AAH...xyz"
  echo ""
  press_enter_to_continue

  echo ""
  local tg_token=""
  while [[ -z "$tg_token" ]]; do
    read -rsp "  Paste the bot token from BotFather (input hidden): " tg_token
    echo ""
    if [[ ! "$tg_token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
      warn_msg "That does not look like a Telegram bot token (expected format: number:letters). Try again, or press Ctrl+C to skip."
      tg_token=""
    fi
  done
  check_pass "Token recorded for ${display_name}."

  echo ""
  echo "  ${C_BOLD}Step 2 of 3 -- Find your Telegram chat ID${C_RESET}"
  echo ""
  echo "  The chat ID is the number that identifies YOUR conversation with"
  echo "  this bot. Only this chat ID will be allowed to talk to this bot --"
  echo "  any other user is silently ignored. This is your security boundary."
  echo ""
  echo "  In Telegram, search for the bot you just created (the username"
  echo "  ending in 'bot'), open a chat with it, and send the message:"
  echo ""
  echo "         ${C_BOLD}/start${C_RESET}"
  echo ""
  echo "  Then come back here and press Return. The installer will fetch the"
  echo "  chat ID from Telegram automatically."
  echo ""
  press_enter_to_continue

  echo ""
  info_msg "Looking up your chat ID via the Telegram API..."
  local updates_json
  updates_json=$(curl -fsSL "https://api.telegram.org/bot${tg_token}/getUpdates" 2>/dev/null || echo "")
  local chat_id=""
  if [[ -n "$updates_json" ]]; then
    chat_id=$(echo "$updates_json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('ok') and data.get('result'):
        last = data['result'][-1]
        msg = last.get('message') or last.get('channel_post') or {}
        chat = msg.get('chat', {})
        cid = chat.get('id')
        if cid: print(cid)
except Exception:
    pass
" 2>/dev/null)
  fi

  if [[ -z "$chat_id" ]]; then
    warn_msg "Could not detect a chat ID automatically."
    echo "  This usually means you have not messaged the bot yet."
    echo "  Open Telegram -> find the bot you created -> send /start"
    echo "  -- then come back and press Return to retry, or paste the ID manually."
    echo ""
    read -rp "  Press Return to retry, or paste your numeric chat ID directly: " manual
    if [[ "$manual" =~ ^-?[0-9]+$ ]]; then
      chat_id="$manual"
    else
      # one retry of the API
      updates_json=$(curl -fsSL "https://api.telegram.org/bot${tg_token}/getUpdates" 2>/dev/null || echo "")
      chat_id=$(echo "$updates_json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('ok') and data.get('result'):
        last = data['result'][-1]
        msg = last.get('message') or last.get('channel_post') or {}
        chat = msg.get('chat', {})
        cid = chat.get('id')
        if cid: print(cid)
except Exception:
    pass
" 2>/dev/null)
    fi
  fi

  if [[ -z "$chat_id" ]]; then
    error_msg "Still could not get a chat ID. Skipping Telegram for ${display_name}."
    echo "  You can re-run this step later with:"
    echo "      sudo bash /opt/pandoras-box/scripts/setup-telegram.sh ${slug}"
    eval "TELEGRAM_BOT_TOKEN_${slug}=\"\""
    eval "TELEGRAM_CHAT_ID_${slug}=\"\""
    return 0
  fi
  check_pass "Detected chat ID: ${chat_id}"

  echo ""
  echo "  ${C_BOLD}Step 3 of 3 -- Verify with a test message${C_RESET}"
  echo ""
  info_msg "Sending a test message to your Telegram..."
  local resp
  resp=$(curl -fsSL "https://api.telegram.org/bot${tg_token}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=Hello from ${display_name}. Setup successful." \
    2>/dev/null || echo "")
  if echo "$resp" | grep -q '"ok":true'; then
    check_pass "Test message sent. Check your Telegram now."
  else
    warn_msg "Test message did not send. Check the token and chat ID and re-run setup."
    eval "TELEGRAM_BOT_TOKEN_${slug}=\"\""
    eval "TELEGRAM_CHAT_ID_${slug}=\"\""
    return 0
  fi

  eval "TELEGRAM_BOT_TOKEN_${slug}='${tg_token}'"
  eval "TELEGRAM_CHAT_ID_${slug}='${chat_id}'"
  echo ""
  success_msg "Telegram bot for ${display_name} is configured."
  echo ""
}
