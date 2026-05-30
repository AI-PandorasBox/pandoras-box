# =============================================================================
# setup-relays.sh -- Optional messaging relays (Discord, Slack, WhatsApp)
# Each is independent; user can pick any subset.
# =============================================================================

run_discord_relay_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "Discord relay" \
    "Receive and reply to your Personal Assistant via Discord DMs. Useful if your friends/team use Discord and you want a single chat surface. The relay is one-way personal -- only your Discord user account can address the bot." \
    "A Discord account, a Discord application + bot token (5 minutes via https://discord.com/developers/applications), and your Discord user ID (ten or so digits)." \
    "Free." \
    "~5 minutes"

  prompt_yes_no "Set up Discord relay?" d_choice "no"
  if [[ "$d_choice" != "yes" ]]; then return 0; fi

  echo ""
  echo "  1. Go to https://discord.com/developers/applications"
  echo "  2. New Application -> name 'Pandoras Box' -> Create"
  echo "  3. Bot tab -> Add Bot -> Reset Token -> copy the token"
  echo "  4. OAuth2 tab -> URL Generator -> scope 'bot' -> permissions"
  echo "     'Send Messages' + 'Read Message History' -> copy URL -> open it"
  echo "     -> add the bot to your personal server"
  echo "  5. In Discord, enable Developer Mode (Settings -> Advanced) ->"
  echo "     right-click your username -> Copy User ID"
  echo ""
  press_enter_to_continue
  read -rsp "  Discord bot token (input hidden): " DISCORD_BOT_TOKEN
  echo ""
  prompt_required "Your Discord user ID (numeric)" DISCORD_USER_ID
  export DISCORD_BOT_TOKEN DISCORD_USER_ID
  success_msg "Discord relay configured."
}

run_slack_relay_setup() {
  print_module_info_card \
    "Slack relay" \
    "Receive and reply to your Personal Assistant via a Slack DM in your workspace. Same model as Discord -- single user, no public channels." \
    "A Slack workspace where you can install apps, an app + bot token (xoxb-...), and your Slack user ID." \
    "Free (Slack free tier works)." \
    "~5 minutes"

  prompt_yes_no "Set up Slack relay?" s_choice "no"
  if [[ "$s_choice" != "yes" ]]; then return 0; fi

  echo ""
  echo "  1. Go to https://api.slack.com/apps -> Create New App -> 'From scratch'"
  echo "  2. App Name 'Pandoras Box' -> pick your workspace"
  echo "  3. OAuth & Permissions -> Bot Token Scopes -> add chat:write,"
  echo "     im:history, im:read, users:read"
  echo "  4. Install to Workspace -> copy the Bot User OAuth Token (xoxb-...)"
  echo "  5. Find your user ID: in Slack, click your profile -> ... -> Copy member ID"
  echo ""
  press_enter_to_continue
  read -rsp "  Slack bot token (xoxb-..., input hidden): " SLACK_BOT_TOKEN
  echo ""
  prompt_required "Your Slack user ID (starts with U)" SLACK_USER_ID
  export SLACK_BOT_TOKEN SLACK_USER_ID
  success_msg "Slack relay configured."
}

run_whatsapp_relay_setup() {
  print_module_info_card \
    "WhatsApp relay (UNOFFICIAL bridge)" \
    "Receive and reply via WhatsApp. NOTE: this uses an unofficial WhatsApp Web bridge. WhatsApp could block such use at any time. Do not use this on a number you cannot afford to lose. A separate WhatsApp account on a separate phone number is strongly recommended." \
    "A separate WhatsApp number (not your primary). A phone (or burner) you can scan a QR code with on first run." \
    "WhatsApp itself is free. The unofficial bridge has no licence cost. Risk of account block is the cost." \
    "~5 minutes (plus QR scan on first run)"

  echo ""
  warn_msg "WhatsApp relay is experimental and uses an UNOFFICIAL bridge."
  prompt_yes_no "I understand the risk and want to install WhatsApp relay" w_choice "no"
  if [[ "$w_choice" != "yes" ]]; then return 0; fi

  prompt_required "WhatsApp number to use (E.164, e.g. +447700900000)" WHATSAPP_NUMBER
  export WHATSAPP_NUMBER
  echo ""
  info_msg "On first run, the bridge will display a QR code. Scan it with the"
  info_msg "WhatsApp app on the phone using $WHATSAPP_NUMBER -> Linked Devices."
  success_msg "WhatsApp relay enabled (post-install QR scan required)."
}
