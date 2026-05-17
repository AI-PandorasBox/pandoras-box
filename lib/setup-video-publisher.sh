# =============================================================================
# setup-video-publisher.sh -- Video production + YouTube upload pipeline
# =============================================================================

run_video_publisher_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "Video publisher" \
    "Generic video production pipeline. Takes a script (or auto-generates one from a topic), runs ElevenLabs TTS for narration, generates visuals (Puppeteer-rendered HTML cards or static images), assembles via ffmpeg, and uploads to YouTube. Use cases: explainer videos, product demos, narrated tutorials, weekly recap videos. the Media Production Pipeline reuses this pipeline; if you installed the Media Production Pipeline, the YouTube auth is shared." \
    "ElevenLabs voice ID (already set if you chose voice). YouTube channel + OAuth client (shared with the Media Production Pipeline if installed). ffmpeg (auto-installed). Optional: a paid image-gen API for richer visuals." \
    "ElevenLabs charges per character of narration. YouTube upload is free. Image gen costs depend on the source you pick (free options exist via Pollinations etc.)." \
    "~5 minutes (longer if no YouTube OAuth client yet)"

  prompt_yes_no "Set up Video publisher?" v_choice "no"
  if [[ "$v_choice" != "yes" ]]; then return 0; fi

  if ! command -v ffmpeg &>/dev/null; then
    brew install ffmpeg 2>&1 | tail -3 || error_exit "Could not install ffmpeg."
  fi

  if [[ -z "${YT_CLIENT_ID:-}" ]]; then
    echo ""
    echo "  Video publisher needs a YouTube OAuth client (same as the Media Production Pipeline)."
    echo "  If you already set up the Media Production Pipeline, the same client is reused."
    echo "  Otherwise see the the Media Production Pipeline module for the Google Cloud setup steps."
    echo ""
    prompt_required "YouTube channel ID (UC...)" VP_CHANNEL_ID
    prompt_required "OAuth Client ID" VP_CLIENT_ID
    read -rsp "  OAuth Client Secret (hidden): " VP_CLIENT_SECRET
    echo ""
    export VP_CHANNEL_ID VP_CLIENT_ID VP_CLIENT_SECRET
  fi

  success_msg "Video publisher configured."
}
