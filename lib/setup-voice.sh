# =============================================================================
# setup-voice.sh -- ElevenLabs voice setup (TTS for Personal Assistant + the Media Production Pipeline)
# Optional. If skipped, voice features fall back to macOS `say` or are disabled.
# =============================================================================

run_voice_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  # _A5_INSTALLER_UX_V1 -- point operator at the matching setup guide
  print_setup_guide_link "elevenlabs"
  print_module_info_card \
    "ElevenLabs voice (TTS)" \
    "Cloned-quality text-to-speech for the Personal Assistant's voice replies, the Call mode native voice (when Gemini Live is not used), the watch companion's spoken summaries, and the Media Production Pipeline's video narration. Without this, voice features fall back to macOS's built-in 'say' command (functional, robotic). With this, the assistant has a natural-sounding voice you choose or clone." \
    "An ElevenLabs account (free tier works for testing). For best quality, a paid plan that includes Voice Cloning. The voice ID of the voice you want to use." \
    "ElevenLabs free tier: 10,000 chars/month. Starter: \$5/month for 30,000 chars. Creator (with cloning): \$22/month for 100,000 chars. Heavy users may want Pro at \$99/month." \
    "~3 minutes"

  prompt_yes_no "Set up ElevenLabs voice now?" voice_choice "no"
  if [[ "$voice_choice" != "yes" ]]; then
    info_msg "Skipping ElevenLabs. Voice features will use macOS 'say' as fallback."
    export ELEVENLABS_API_KEY=""
    export ELEVENLABS_VOICE_ID=""
    return 0
  fi

  echo ""
  echo "  ${C_BOLD}Step 1 -- Get your API key${C_RESET}"
  echo ""
  echo "  1. Go to https://elevenlabs.io and sign in (or create an account)"
  echo "  2. Click your profile picture (top right) -> 'API Keys'"
  echo "  3. Click 'Create API Key' -> name it 'Pandoras Box' -> Create"
  echo "  4. Copy the key (starts with 'sk_')"
  echo ""
  press_enter_to_continue

  local key=""
  while [[ -z "$key" ]]; do
    read -rsp "  Paste your ElevenLabs API key (input hidden): " key
    echo ""
    if [[ ! "$key" =~ ^sk_[a-f0-9]{48}$ ]]; then
      warn_msg "That does not look right (should start with 'sk_' and be 51 chars total). Try again or press Ctrl+C to skip."
      key=""
    fi
  done

  # Validate via API
  info_msg "Validating key with ElevenLabs..."
  if curl -fsSL "https://api.elevenlabs.io/v1/user" -H "xi-api-key: $key" -o /tmp/elv.json 2>/dev/null; then
    local subscription=$(python3 -c "import sys,json; d=json.load(open('/tmp/elv.json')); print(d.get('subscription',{}).get('tier','unknown'))" 2>/dev/null || echo "unknown")
    check_pass "Key validated. Subscription tier: $subscription"
    rm -f /tmp/elv.json
  else
    warn_msg "Key validation failed. Check the key and try again."
    return 1
  fi

  echo ""
  echo "  ${C_BOLD}Step 2 -- Pick a voice${C_RESET}"
  echo ""
  echo "  Voice IDs are 20-character strings shown next to each voice in your"
  echo "  ElevenLabs dashboard at https://elevenlabs.io/app/voice-library"
  echo ""
  echo "  Common starting points:"
  echo "    - Rachel (default female, professional):  21m00Tcm4TlvDq8ikWAM"
  echo "    - Adam   (default male, narrator):        pNInz6obpgDQGcFmaJgB"
  echo "    - Domi   (younger, conversational):       AZnzlk1XvdvUeBnXmlld"
  echo ""
  echo "  Or paste a Voice ID for your own cloned voice."
  echo ""

  local voice_id=""
  while [[ -z "$voice_id" ]]; do
    read -rp "  Voice ID: " voice_id
    if [[ ${#voice_id} -lt 15 ]]; then
      warn_msg "Voice ID looks too short. Try again."
      voice_id=""
    fi
  done

  # Sample test
  info_msg "Generating a test sample (5 seconds)..."
  if curl -fsSL "https://api.elevenlabs.io/v1/text-to-speech/$voice_id" \
       -H "xi-api-key: $key" \
       -H "Content-Type: application/json" \
       -o /tmp/voice-test.mp3 \
       -d '{"text":"Hello. This is your assistant on Pandoras Box.","model_id":"eleven_turbo_v2"}' 2>/dev/null; then
    check_pass "Sample saved to /tmp/voice-test.mp3"
    if command -v afplay &>/dev/null; then
      afplay /tmp/voice-test.mp3 2>/dev/null || true
    fi
    rm -f /tmp/voice-test.mp3
  else
    warn_msg "Could not generate a sample. Voice ID may be invalid or quota exceeded."
  fi

  export ELEVENLABS_API_KEY="$key"
  export ELEVENLABS_VOICE_ID="$voice_id"

  echo ""
  success_msg "ElevenLabs voice configured."
  echo ""
  press_enter_to_continue
}
