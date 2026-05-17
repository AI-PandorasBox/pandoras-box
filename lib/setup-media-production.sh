# =============================================================================
# setup-media-production.sh -- the Media Production Pipeline: AI music + video pipeline with YouTube publishing
# Optional. Themed weekly music channel with approval gate.
# =============================================================================

run_media_production_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  # _A5_INSTALLER_UX_V1 -- point operator at the matching setup guide
  print_setup_guide_link "youtube"
  print_module_info_card \
    "the Media Production Pipeline (YouTube channel pipeline)" \
    "An AI-managed weekly rotating ambient music channel on YouTube. the Media Production Pipeline picks themes, generates music previews using Suno or Lyria, holds them at an approval gate for you to accept or reject, then publishes accepted tracks as YouTube videos with AI-generated visuals. Includes view tracking and automatic theme rotation. Useful for: ambient channels, study/focus playlists, lo-fi rotations, themed weekly drops." \
    "A YouTube channel (you can create one in 2 minutes if you don't have one), a Google Cloud project with YouTube Data API v3 enabled, an OAuth client ID + secret, plus your channel ID. ElevenLabs API key (already set up if you chose voice). ffmpeg installed (the Media Production Pipeline auto-installs via Homebrew)." \
    "Music generation: Suno (paid -- \$8-30/month plans) OR Lyria via Gemini paid API (pay per use, behind your daily cap). YouTube publishing: free. Storage: ~1GB per 50 tracks locally before YouTube upload." \
    "~10 minutes (longer if you do not have a Google Cloud project yet)"

  prompt_yes_no "Set up the Media Production Pipeline now?" cal_choice "no"
  if [[ "$cal_choice" != "yes" ]]; then
    info_msg "Skipping the Media Production Pipeline. You can re-run this later: sudo bash $INSTALL_PATH/scripts/setup-media-production.sh"
    return 0
  fi

  # ffmpeg
  info_msg "Step 1 of 5: Install ffmpeg..."
  if ! command -v ffmpeg &>/dev/null; then
    brew install ffmpeg 2>&1 | tail -3 || error_exit "Could not install ffmpeg."
  fi
  check_pass "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

  echo ""
  echo "  ${C_BOLD}Step 2 of 5 -- YouTube channel${C_RESET}"
  echo ""
  echo "  the Media Production Pipeline publishes to a YouTube channel. You need:"
  echo "    1. A YouTube channel (https://youtube.com/account/create)"
  echo "    2. The channel ID (starts with UC -- find it at"
  echo "       https://www.youtube.com/account_advanced)"
  echo ""
  press_enter_to_continue
  prompt_required "YouTube channel ID (starts with UC)" YT_CHANNEL_ID
  if [[ ! "$YT_CHANNEL_ID" =~ ^UC[A-Za-z0-9_\-]{20,}$ ]]; then
    warn_msg "That does not look like a YouTube channel ID. Continue anyway? Press Return to keep, or Ctrl+C to abort."
    read -r
  fi

  echo ""
  echo "  ${C_BOLD}Step 3 of 5 -- Google Cloud OAuth client${C_RESET}"
  echo ""
  echo "  1. Go to https://console.cloud.google.com/apis/credentials"
  echo "  2. Pick or create a project (e.g. 'Pandoras Box - the Media Production Pipeline')"
  echo "  3. Enable APIs: YouTube Data API v3 (+ Generative Language for Lyria)"
  echo "  4. Create OAuth 2.0 Client ID:"
  echo "     - Application type: Desktop app"
  echo "     - Name: Pandoras Box the Media Production Pipeline"
  echo "  5. Copy the Client ID + Client Secret"
  echo ""
  press_enter_to_continue
  prompt_required "Google OAuth Client ID" YT_CLIENT_ID
  read -rsp "  Google OAuth Client Secret (input hidden): " YT_CLIENT_SECRET
  echo ""

  echo ""
  echo "  ${C_BOLD}Step 4 of 5 -- Music generation source${C_RESET}"
  echo ""
  echo "  Pick one:"
  echo "    1) Suno (paid, easier setup, very good output -- \$8-30/month)"
  echo "    2) Lyria via Google AI paid API (pay-per-use, behind daily cap)"
  echo "    3) None (the Media Production Pipeline still works for video publishing of your own tracks)"
  echo ""
  read -rp "  Choice [1/2/3, default 3]: " music_choice
  music_choice="${music_choice:-3}"

  case "$music_choice" in
    1)
      echo ""
      echo "  Get a Suno API key at https://suno.com (Pro plan or higher)"
      read -rsp "  Suno API key (input hidden): " SUNO_API_KEY
      echo ""
      ;;
    2)
      info_msg "Lyria reuses your Google API paid key from the Gemini setup."
      info_msg "If you skipped that step, re-run setup-gemini.sh first."
      ;;
    *)
      info_msg "Skipping music generation -- you can publish your own tracks via the Media Production Pipeline's drop folder."
      ;;
  esac

  echo ""
  echo "  ${C_BOLD}Step 5 of 5 -- Approval gate${C_RESET}"
  echo ""
  echo "  the Media Production Pipeline generates a preview, then waits for you to approve or"
  echo "  reject before publishing. You can approve/reject from:"
  echo "    -  The Personal Assistant's the Media Production Pipeline tab"
  echo "    -  An emailed link"
  echo "    -  A Telegram message (if Telegram is set up)"
  echo ""
  prompt_yes_no "Send approval prompts via email?" cal_email_approve "yes"
  prompt_yes_no "Send approval prompts via Telegram?" cal_tg_approve "yes"

  echo ""
  success_msg "the Media Production Pipeline configured."
  echo "  YouTube channel:  $YT_CHANNEL_ID"
  echo "  OAuth client:     $YT_CLIENT_ID"
  echo "  Approval routes:  email=$cal_email_approve, telegram=$cal_tg_approve"
  echo ""
  press_enter_to_continue
}
