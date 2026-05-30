# _A6_1_NARRATIVE_SCRUB_V1
# =============================================================================
# setup-gemini.sh -- Gemini AI Pro for the Personal AI Create-tab tools
# Optional. Powers grounded_search, deep_research, generate_image via Google's
# AI Pro subscription instead of the paid Google API.
# =============================================================================

run_gemini_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  # _A5_INSTALLER_UX_V1 -- point operator at the matching setup guide
  print_setup_guide_link "google-ai"
  print_module_info_card \
    "Gemini AI Pro (Personal AI Create-tab)" \
    "Adds web-grounded search, deep research, and AI image generation to your Personal Assistant. Uses your Google AI Pro subscription via the Gemini CLI -- no per-call API billing for these features. Without this, the personal assistant still works but the Create-tab tools (grounded search, deep research, image gen) are unavailable. Optional paid extras (Lyria music, Veo video) require a separate paid Google API key behind a daily spend cap." \
    "A Google account, ideally on Google AI Pro (£18.99/month at time of writing). 5 minutes to walk through Google CLI sign-in." \
    "Google AI Pro: ~£19/month (free tier exists but quotas are tight). Lyria/Veo are pay-per-use behind a daily cap you set." \
    "~5 minutes"

  prompt_yes_no "Set up Gemini AI Pro for the Personal Assistant?" gemini_choice "no"
  if [[ "$gemini_choice" != "yes" ]]; then
    info_msg "Skipping Gemini. You can re-run this later: sudo bash $INSTALL_PATH/scripts/setup-gemini.sh"
    return 0
  fi

  echo ""
  info_msg "Step 1 of 3: Install the Gemini CLI..."
  if command -v gemini &>/dev/null; then
    check_pass "Gemini CLI already installed: $(gemini --version 2>&1 | head -1)"
  else
    if ! npm install -g @google/gemini-cli 2>&1 | tail -3; then
      warn_msg "Could not install Gemini CLI via npm. Try manually: 'sudo npm install -g @google/gemini-cli', then re-run."
      return 1
    fi
    check_pass "Gemini CLI installed."
  fi

  echo ""
  info_msg "Step 2 of 3: Sign in to Google..."
  echo ""
  echo "  A browser window will open. Sign in to the Google account that"
  echo "  carries your Google AI Pro subscription."
  echo ""
  echo "  If you do not have a Google AI Pro subscription, you can still"
  echo "  sign in -- but quotas will be tight. Subscribe at:"
  echo "      https://gemini.google.com/subscriptions"
  echo ""
  press_enter_to_continue

  if ! gemini auth login 2>&1; then
    warn_msg "Sign-in did not complete. You can run 'gemini auth login' manually any time."
    return 1
  fi
  check_pass "Signed in to Google."

  echo ""
  info_msg "Step 3 of 3: Install the OAuth vault + daily refresh..."

  local VAULT_DIR="$INSTALL_PATH/personal-ai/store/gemini-vault"
  sudo mkdir -p "$VAULT_DIR"

  # Move (not symlink) gemini CLI tokens into the vault. Mode 660 is critical:
  # 640 mode breaks the refresh script.
  local GEMINI_TOKEN_DIR="$HOME/.gemini"
  if [[ -d "$GEMINI_TOKEN_DIR" ]]; then
    sudo cp -R "$GEMINI_TOKEN_DIR/." "$VAULT_DIR/"
    sudo chmod 660 "$VAULT_DIR"/*.json 2>/dev/null || true
    sudo chmod 770 "$VAULT_DIR"
    sudo chown -R "$(whoami):staff" "$VAULT_DIR"
    check_pass "Vault populated at $VAULT_DIR (mode 660)"
  fi

  # Install daily refresh LaunchAgent
  local REFRESH_PLIST="$HOME/Library/LaunchAgents/com.pandoras-box.gemini-token-refresh.plist"
  cat > "/tmp/pbox-gemini-refresh.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandoras-box.gemini-token-refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALL_PATH/scripts/gemini-refresh.sh</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/pbox-gemini-refresh.log</string>
  <key>StandardErrorPath</key><string>/tmp/pbox-gemini-refresh.log</string>
</dict>
</plist>
PLIST
  mv "/tmp/pbox-gemini-refresh.plist" "$REFRESH_PLIST"
  launchctl load "$REFRESH_PLIST" 2>/dev/null || true
  check_pass "Gemini token refresh LaunchAgent installed (every 30 min)."

  echo ""
  prompt_yes_no "Add a paid Google API key for Lyria (music) and Veo (video)?" lyria_veo "no"
  if [[ "$lyria_veo" == "yes" ]]; then
    echo ""
    echo "  Get an API key from: https://console.cloud.google.com/apis/credentials"
    echo "  Then enable Generative Language + Vertex AI APIs on that project."
    echo ""
    local gkey=""
    while [[ -z "$gkey" ]]; do
      read -rsp "  Paste your Google API key (input hidden): " gkey
      echo ""
      if [[ ! "$gkey" =~ ^AIza[A-Za-z0-9_\-]{35}$ ]]; then
        warn_msg "That does not look like a Google API key (should start with 'AIza' and be 39 chars). Try again or press Ctrl+C to skip."
        gkey=""
      fi
    done
    export GOOGLE_API_KEY_PAID="$gkey"
    echo ""
    prompt_with_default "Daily spend cap for Lyria + Veo (GBP)" "1.00" GEMINI_DAILY_CAP_GBP
    check_pass "Paid API key + £$GEMINI_DAILY_CAP_GBP/day cap recorded."
  fi

  echo ""
  success_msg "Gemini AI Pro configured."
  echo ""
}
