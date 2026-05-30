# _A6_1B_TIER_LABELS_V1
# =============================================================================
# setup-modules.sh -- Optional module picker
# Each entry shows its info card via offer_module(), runs the corresponding
# setup-X.sh routine if accepted. ALL modules are optional after the core +
# Personal Assistant are in place.
# =============================================================================

run_module_selection() {
  section_header "Optional modules"
  echo "  Pandoras Box has optional modules. Each is independent. You can pick"
  echo "  any subset. You can re-run this picker at any time later via:"
  echo ""
  echo "      sudo bash $INSTALL_PATH/scripts/add-module.sh"
  echo ""
  echo "  Each module shows: what it does, what you'll need, third-party costs,"
  echo "  and how long it takes to set up. Read each card before deciding."
  echo ""
  press_enter_to_continue

  # SELECTED_MODULES_LIST: space-separated, bash-3.2 compatible.
  SELECTED_MODULES_LIST=""
  SELECTED_MODULES_SKIPPED=""

  # ──── Module: backups ────────────────────────────────────────────────────
  if offer_module "[RECOMMENDED] Encrypted backups" \
    "Nightly age-encrypted tarball of your databases and config, with a Sunday freshness probe. Strongly recommended for any production-ish use." \
    "Nothing -- the installer generates the encryption key and stores it in macOS Keychain." \
    "Free. age via Homebrew. No cloud charges." \
    "~3 minutes" \
    "yes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST backups"
    run_backups_setup
  fi

  # ──── Module: ollama ─────────────────────────────────────────────────────
  if offer_module "[OPTIONAL] Local LLM (Ollama)" \
    "Runs an open-weight model locally for high-volume classification (intent routing, simple Q&A). Eliminates the most frequent paid-API calls. Recommended if you have multiple companies set up." \
    "16 GB RAM minimum (32 GB comfortable). About 10 GB disk for the model. No accounts." \
    "Free. CPU inference. Slower than cloud but quotaless." \
    "~10 minutes (most of which is the model download)"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST ollama"
    run_ollama_setup
  fi

  # ──── Module: dashboard ──────────────────────────────────────────────────
  if offer_module "[RECOMMENDED] Status dashboard" \
    "A local web page on your LAN/Tailnet showing every service's health, recent jobs, MS365 token status, dep-scan findings, and current API spend. Refreshes every 30 seconds." \
    "Nothing." \
    "Free." \
    "~1 minute" \
    "yes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST dashboard"
    run_dashboard_setup
  fi

  # ──── Module: terminal ───────────────────────────────────────────────────
  if offer_module "[OPTIONAL] Browser terminal" \
    "PBKDF2-authenticated terminal you can open in any browser on your Tailnet. Useful for admin from a phone or tablet without SSH keys." \
    "A passphrase you'll set during install." \
    "Free." \
    "~2 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST terminal"
    run_terminal_setup
  fi

  # ──── Module: admin-lite ─────────────────────────────────────────────────
  if offer_module "[OPTIONAL] Admin Lite (mobile admin panel)" \
    "PIN-locked mobile-friendly admin web app. Status, agent restart, command queue. Tailnet-only. Useful for restarting a frozen agent from your phone." \
    "A 4-6 digit PIN you'll set during install. Tailscale on your phone." \
    "Free." \
    "~2 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST admin-lite"
    run_admin_lite_setup
  fi

  # ──── Module: admin-shell ────────────────────────────────────────────────
  if offer_module "[OPTIONAL] Admin Shell (Chrome desktop app)" \
    "Standalone Chrome desktop app for the Admin Shell -- opens as its own window (not a browser tab) for focused administration. Same auth surface as admin-lite, different UX." \
    "Google Chrome installed on this machine." \
    "Free." \
    "~2 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST admin-shell"
    run_admin_shell_setup
  fi

  # ──── Module: docs-server ────────────────────────────────────────────────
  if offer_module "[RECOMMENDED] Docs server (local manuals website)" \
    "Hosts the Pandoras Box manuals as a navigable website on your LAN/Tailnet. Open in any browser, search, share links to specific sections. Useful when you need to look something up without leaving your work." \
    "Nothing." \
    "Free." \
    "~1 minute" \
    "yes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST docs-server"
    run_docs_server_setup
  fi

  # ──── Module: personal-sensor (sensor + watch) ────────────────────────────────────
  if offer_module "[OPTIONAL] the Personal Sensor Layer + Watch (personal intelligence)" \
    "Ambient signal layer (calendar proximity, gone-quiet contacts, named places, free-time gaps) + watch companion (Wear OS or Apple Watch). Sensor and surface in one module." \
    "Optional Pixel/Galaxy/Apple Watch. Phone with Tailscale. Addresses to geofence." \
    "Free." \
    "~10 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST personal-sensor"
    run_personal_sensor_setup
  fi

  # ──── Module: offline-kb (offline knowledge) ─────────────────────────────────
  # _A5_INSTALLER_UX_V1 -- pre-check Docker before offering the Offline Knowledge Library
  if offer_module "[OPTIONAL] the Offline Knowledge Library (offline knowledge base)" \
    "Indexes Wikipedia, Stack Overflow, iFixit, Project Gutenberg, etc. -- all OFFLINE. Your assistant prefers the Offline Knowledge Library for stable reference content, only falls back to live web search for current events. Cuts Brave Search quota burn dramatically." \
    "50-150 GB free disk. Optional: Docker (Kiwix runs in a container)." \
    "Free. ZIM files are free downloads." \
    "~30 minutes (mostly the ZIM download)"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST offline-kb"
    # _A5_INSTALLER_UX_V1 -- soft dep check before running the Offline Knowledge Library install
    if [[ "$PBOX_OS" == Darwin ]]; then
      check_module_dep "the Offline Knowledge Library" "docker" "brew install --cask docker"
    else
      check_module_dep "the Offline Knowledge Library" "docker" "sudo apt-get install -y docker.io"
    fi
    if [[ "${MODULE_DEP_OK:-false}" == "true" ]]; then
      run_offline_kb_setup
    else
      SELECTED_MODULES_SKIPPED="$SELECTED_MODULES_SKIPPED offline-kb"
    fi
  fi

  # ──── Module: self-improvement (self-improvement) ──────────────────────────────────
  # _A5_INSTALLER_UX_V1 -- the Content Classifier content classifier guardrail
  if offer_module "[RECOMMENDED] the Content Classifier (content safety classifier)" \
    "Lightweight 0.3B-parameter classifier that screens outbound text against six axes (prompt safety, response safety, response refusal, prompt toxicity, response toxicity, jailbreak detection). Runs locally on CPU. Shadow mode by default — observes for 4 weeks of calibration before any blocking, so you see what it would have caught before it actually catches anything." \
    "About 600 MB disk for the model (auto-downloaded from HuggingFace). No accounts. Python 3.11+ (managed by Homebrew)." \
    "Free. Local CPU inference." \
    "~3 minutes (model download dominates)" \
    "yes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST content-classifier"
    # Fail-open vs fail-closed policy
    echo ""
    echo "  When the Content Classifier is offline or fails, should outbound content:"
    echo "    [1] Still go through (fail-open — fewer false stops, less safety)"
    echo "    [2] Be blocked until the Content Classifier recovers (fail-closed — safer)"
    echo ""
    if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
      _cerberus_failmode="2"
    else
      read -rp "  Choose [1/2, default 2]: " _cerberus_failmode
    fi
    _cerberus_failmode="${_cerberus_failmode:-2}"
    if [[ "$_cerberus_failmode" == "1" ]]; then
      export CONTENT_CLASSIFIER_FAIL_MODE="open"
    else
      export CONTENT_CLASSIFIER_FAIL_MODE="closed"
    fi
    info_msg "the Content Classifier fail-mode: ${CONTENT_CLASSIFIER_FAIL_MODE}"
    run_content_classifier_setup
  fi

  if offer_module "[RECOMMENDED] the Self-Improvement Pipeline (self-improvement pipeline)" \
    "Weekly cycle that analyses your assistant's session history, generates tool description and prompt improvement proposals (GEPA), reviews skills the assistant has saved, and surfaces actionable items for you to approve. Slow-burn quality lift." \
    "Nothing." \
    "Free (uses your existing Claude subscription)." \
    "~3 minutes" \
    "yes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST self-improvement"
    run_self_improvement_setup
  fi

  # ──── Module: skills library ─────────────────────────────────────────────
  if offer_module "[OPTIONAL] the Skills Library (reusable skill primitives)" \
    "Tenant-agnostic skill primitives your agents can invoke. Ships build_board_pack_from_calendar (board-pack PDF from MS365 calendar: per-week pull with resume, xlsx assembly with row-count verify, Chrome-headless PDF). One code path, no per-company logic; add your own skills under the module's skills/ dir." \
    "The personal-ai module (provides the Node runtime + calendar MCP + exceljs)." \
    "Free." \
    "~1 minute" \
    "no"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST skills-library"
    run_skills_library_setup
  fi

  # ──── Module: discord relay ──────────────────────────────────────────────
  if offer_module "Discord relay" \
    "Receive and reply to your Personal Assistant via Discord DMs. One-way personal -- only your Discord user can address the bot." \
    "Discord account, app + bot token, your Discord user ID." \
    "Free." \
    "~5 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST relay-discord"
    run_discord_relay_setup
  fi

  # ──── Module: slack relay ────────────────────────────────────────────────
  if offer_module "Slack relay" \
    "Receive and reply to your Personal Assistant via Slack DM in your workspace." \
    "Slack workspace, app + bot token, your Slack user ID." \
    "Free." \
    "~5 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST relay-slack"
    run_slack_relay_setup
  fi

  # ──── Module: whatsapp relay ─────────────────────────────────────────────
  if offer_module "WhatsApp relay (UNOFFICIAL bridge)" \
    "Receive and reply via WhatsApp using an unofficial WhatsApp Web bridge. Risk of account block at any time. Use a separate number." \
    "A separate WhatsApp number on a separate phone. QR scan on first run." \
    "Free + risk." \
    "~5 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST relay-whatsapp"
    run_whatsapp_relay_setup
  fi

  # ──── Module: trading-research (trading) ─────────────────────────────────────────────
  if offer_module "the Trading Research Agent (trading signals + execution)" \
    "Multi-strategy signal generation with optional brokerage execution. Demo-only by default; production switch is a separate step. NOT FINANCIAL ADVICE." \
    "IG demo account (free). 14+ days demo before going live. Risk acknowledgement." \
    "Brokerage spread/commission. NO PROFIT GUARANTEE -- you can lose money." \
    "~10 minutes (demo)"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST trading-research"
    run_trading_research_setup
  fi

  # ──── Module: media-production (YouTube channel) ─────────────────────────────────
  if offer_module "the Media Production Pipeline (YouTube music channel)" \
    "AI-managed weekly music channel on YouTube with theme rotation and approval gate." \
    "YouTube channel, Google Cloud OAuth client, ElevenLabs voice, ffmpeg. Optional Suno or Lyria for music gen." \
    "Music gen \$8-30/month (Suno) or pay-per-use (Lyria). YouTube free." \
    "~10 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST media-production"
    run_media_production_setup
  fi

  # ──── Module: video-publisher ────────────────────────────────────────────
  if offer_module "Video publisher" \
    "Generic video pipeline: script -> ElevenLabs narration -> visuals -> ffmpeg -> YouTube upload. Use for explainers, tutorials, recap videos." \
    "ElevenLabs voice. YouTube channel + OAuth (shared with the Media Production Pipeline if installed)." \
    "ElevenLabs per character. YouTube free." \
    "~5 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST video-publisher"
    run_video_publisher_setup
  fi

  # ──── Module: website-builder ────────────────────────────────────────────
  if offer_module "Website builder" \
    "Lets your Personal Assistant generate, edit, and publish a static brochure website via FTP/SFTP." \
    "FTP host (any hosting provider), domain (optional but expected)." \
    "Hosting £3-10/mo. Domain ~£15/yr." \
    "~5 minutes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST website-builder"
    run_website_builder_setup
  fi

  # ──── Module: desktop launchers ──────────────────────────────────────────
  if offer_module "Desktop launchers" \
    "Clickable .app shortcuts on your Desktop for the Dashboard, Terminal, and Personal Assistant. No more remembering URLs." \
    "Nothing." \
    "Free." \
    "~30 seconds" \
    "yes"; then
    SELECTED_MODULES_LIST="$SELECTED_MODULES_LIST desktop-launchers"
    run_desktop_launcher_setup
  fi

  echo ""
  # Normalise whitespace; count tokens.
  SELECTED_MODULES_LIST="$(echo "$SELECTED_MODULES_LIST" | xargs)"
  if [[ -z "$SELECTED_MODULES_LIST" ]]; then
    info_msg "No optional modules selected. Core + Personal Assistant are still installed."
  else
    success_msg "Selected modules: $SELECTED_MODULES_LIST"
  fi
  export SELECTED_MODULES_LIST
  echo ""
  press_enter_to_continue
}
