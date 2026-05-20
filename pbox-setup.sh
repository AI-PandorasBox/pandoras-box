# _A6_1B_TIER_LABELS_V1
#!/usr/bin/env bash
# =============================================================================
# pbox-setup.sh -- Pandoras Box Installer
# Version: 0.2.0
# Platform: macOS 14+ (Sonoma or later)
# =============================================================================
set -euo pipefail

# Survive headless contexts (CI runners, cron, ssh -T). bash auto-sets TERM=dumb
# when there's no tty, which causes `clear` and `tput` to abort with "TERM
# environment variable not set." under `set -e`. Force a real terminal type
# for the installer's lifetime if the current TERM can't service `clear`.
if [[ -z "${TERM:-}" || "${TERM}" == "dumb" ]]; then
  export TERM="xterm-256color"
fi

PBOX_VERSION="0.2.0"
INSTALL_PATH="/opt/pandoras-box"
SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SETUP_DIR/lib"
CONFIG_DIR="$SETUP_DIR/config"
LOG_FILE="/tmp/pbox-install.log"
STEP_CURRENT=0
STEP_TOTAL=11

# Source libraries (order matters: dry-run first so its shims are in place,
# core next so the prompt helpers exist, then everything else.)
source "$LIB_DIR/setup-dry-run.sh"
source "$LIB_DIR/setup-core.sh"
# If PBOX_DRY_RUN=1, install prompt overrides on top of setup-core.sh.
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  pbox_install_dryrun_prompt_overrides
fi
source "$LIB_DIR/setup-disclaimer.sh"
source "$LIB_DIR/setup-claude.sh"
source "$LIB_DIR/setup-theme.sh"
source "$LIB_DIR/setup-api-keys.sh"
source "$LIB_DIR/setup-tailscale.sh"
source "$LIB_DIR/setup-certificates.sh"
source "$LIB_DIR/setup-telegram.sh"
source "$LIB_DIR/setup-company.sh"
source "$LIB_DIR/setup-tenant-runtimes.sh"
source "$LIB_DIR/setup-mail-google.sh"
source "$LIB_DIR/setup-voice.sh"
source "$LIB_DIR/setup-brave-search.sh"
source "$LIB_DIR/setup-gemini.sh"
source "$LIB_DIR/setup-personal-ai.sh"
source "$LIB_DIR/setup-backups.sh"
source "$LIB_DIR/setup-personal-sensor.sh"
source "$LIB_DIR/setup-offline-kb.sh"
source "$LIB_DIR/setup-relays.sh"
source "$LIB_DIR/setup-trading-research.sh"
source "$LIB_DIR/setup-media-production.sh"
source "$LIB_DIR/setup-video-publisher.sh"
source "$LIB_DIR/setup-website-builder.sh"
source "$LIB_DIR/setup-desktop-launcher.sh"
source "$LIB_DIR/setup-modules.sh"
source "$LIB_DIR/setup-service-provider.sh"
source "$LIB_DIR/setup-staging.sh"
source "$LIB_DIR/setup-system-modules.sh"
source "$LIB_DIR/setup-update-check.sh"

# =============================================================================
# Entry point
# =============================================================================
main() {
  exec > >(tee -a "$LOG_FILE") 2>&1

  print_banner
  run_disclaimer_gate
  check_requirements
  choose_setup_path

  # _A5_INSTALLER_UX_V1 -- topology explainer + preview before any heavy work
  topology_explainer
  pre_install_preview

  # Step 1 -- Claude first, so any later failure has an assistant on hand.
  run_claude_install

  advance_step "[REQUIRED] Theme selection"
  run_theme_selection

  # _STAGE_REPO_V1 -- copy lib/, scripts/, modules/, config/, assets/, manuals/,
  # docs/, hooks/ from the cloned repo to $INSTALL_PATH so every later step
  # can find its siblings at the canonical install path. Runs immediately
  # after theme.conf is written -- INSTALL_PATH is now valid.
  run_staging

  advance_step "[RECOMMENDED] Spend limits and account check"
  run_api_key_collection
  advance_step "[RECOMMENDED] Tailscale private network"
  run_tailscale_setup
  advance_step "[REQUIRED] Security certificates"
  run_certificate_setup
  advance_step "[REQUIRED] Company agents (0 or more)"
  run_company_setup
  advance_step "[REQUIRED] Personal Assistant"
  run_personal_ai_setup

  # _A5_INSTALLER_UX_V1 -- show skills the Personal AI ships with
  display_installed_skills

  advance_step "[OPTIONAL] Add-on modules"
  run_module_selection

  # _A5_INSTALLER_UX_V1 -- final summary + confirmation before any heavy module work
  post_selection_summary
  if [[ "${SETUP_PATH:-A}" == "B" ]]; then
    advance_step "[OPTIONAL] Service provider extras"
    run_service_provider_setup
  fi
  advance_step "[REQUIRED] System verification"
  run_system_check
  run_update_check_setup
  print_done
}

print_banner() {
  clear
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════════╗"
  echo "  ║                                                              ║"
  echo "  ║           PANDORAS BOX  --  Installer v${PBOX_VERSION}               ║"
  echo "  ║                                                              ║"
  echo "  ╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Welcome. This installer will walk you through setting up Pandoras"
  echo "  Box on your Mac, one step at a time."
  echo ""
  echo "  ${C_BOLD}You do not need any technical knowledge to complete this setup.${C_RESET}"
  echo "  Every step explains what is happening, what you'll need to provide,"
  echo "  any third-party costs, and roughly how long it takes."
  echo ""
  echo "  ${C_BOLD}How error handling works${C_RESET}"
  echo "  Step 1 installs Claude (the AI from Anthropic) and briefs it about"
  echo "  your install. From that point on, if anything goes wrong, you'll"
  echo "  see this prompt:"
  echo ""
  echo "      ${C_CYAN}Ask Claude to help diagnose this? [Y/n]${C_RESET}"
  echo ""
  echo "  Press Return and Claude will read the install log, identify the"
  echo "  problem, and tell you what to do next in plain English."
  echo ""
  echo "  Installation log: $LOG_FILE"
  echo ""
  press_enter_to_continue
}

check_requirements() {
  section_header "Checking your Mac meets the requirements"
  echo "  Before we start, we need to check a few things..."
  echo ""

  local ok=true

  local macos_version
  macos_version=$(sw_vers -productVersion)
  local macos_major
  macos_major=$(echo "$macos_version" | cut -d. -f1)
  if [[ "$macos_major" -ge 14 ]]; then
    check_pass "macOS version: $macos_version"
  else
    check_fail "macOS version: $macos_version (requires 14.0 or later)"
    echo "  Fix: Apple menu -> System Settings -> General -> Software Update."
    ok=false
  fi

  # Find Node. Some shells don't have brew's PATH set up; check common install
  # locations directly. Order: PATH, then /opt/homebrew (Apple Silicon brew),
  # then /usr/local/bin (Intel brew or manual install), then /usr/bin.
  local node_bin=""
  for candidate in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      node_bin="$candidate"
      break
    fi
  done
  if [[ -n "$node_bin" ]]; then
    local node_version=$("$node_bin" --version)
    local node_major=$(echo "$node_version" | tr -d 'v' | cut -d. -f1)
    if [[ "$node_major" -ge 20 ]]; then
      check_pass "Node.js: $node_version  ($node_bin)"
      # Export so later steps don't need to re-discover.
      export PBOX_NODE_BIN="$node_bin"
    else
      check_fail "Node.js: $node_version (requires v20 or later)"
      echo "  Fix: brew upgrade node"
      ok=false
    fi
  else
    check_fail "Node.js: not found in PATH or at /opt/homebrew/bin/node or /usr/local/bin/node"
    echo "  Fix: open a terminal, run 'brew install node', then re-run this installer."
    ok=false
  fi

  if command -v brew &>/dev/null; then
    check_pass "Homebrew: found"
  else
    check_fail "Homebrew: not found"
    echo "  Fix: visit https://brew.sh and follow the on-screen install command."
    ok=false
  fi

  if sudo -n true 2>/dev/null; then
    check_pass "Admin access: confirmed"
  else
    info_msg "Admin access: you'll be asked for your Mac password during setup."
    echo "  This is needed to create service accounts and install system services."
    echo "  Your password is never stored anywhere."
  fi

  echo ""
  if [[ "$ok" != "true" ]]; then
    error_exit "One or more requirements not met. Resolve the issues above and re-run."
  fi
  success_msg "All requirements met. Ready to proceed."
  echo ""
  press_enter_to_continue
}

choose_setup_path() {
  section_header "What are you setting up?"
  echo "  Choose the option that describes you:"
  echo ""
  echo "  ${C_BOLD}1) Personal / Single Organisation${C_RESET}"
  echo "     You're setting up Pandoras Box for yourself or one organisation."
  echo "     This is the standard path for most users."
  echo ""
  echo "  ${C_BOLD}2) Service Provider${C_RESET}"
  echo "     You're setting up Pandoras Box to manage AI systems for multiple"
  echo "     paying clients. This adds tools for client onboarding, multi-tenant"
  echo "     management, and a welcome pack template."
  echo ""
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    setup_choice="${PBOX_DRY_RUN_PATH:-1}"
    info_msg "[DRY-RUN] tier choice auto-set to '$setup_choice' (override with PBOX_DRY_RUN_PATH=2)"
  else
    read -rp "  Enter 1 or 2 [default: 1]: " setup_choice
    setup_choice="${setup_choice:-1}"
  fi

  case "$setup_choice" in
    1) export SETUP_PATH="A"
       success_msg "Personal / Single Organisation selected."
       STEP_TOTAL=10 ;;
    2) export SETUP_PATH="B"
       success_msg "Service Provider mode selected."
       STEP_TOTAL=11 ;;
    *) warn_msg "Invalid choice. Defaulting to Personal."
       export SETUP_PATH="A"
       STEP_TOTAL=10 ;;
  esac
  echo ""
}

print_done() {
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════════╗"
  echo "  ║                                                              ║"
  echo "  ║   Installation complete. Pandoras Box is running.            ║"
  echo "  ║                                                              ║"
  echo "  ╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Full install log: $LOG_FILE"
  echo ""
  echo "  ${C_BOLD}Next steps${C_RESET}"
  echo "  1. Install the CA certificate on your other devices:"
  echo "       see $INSTALL_PATH/docs/certificates.md"
  echo "  2. Install Tailscale on your phone and other devices:"
  echo "       see $INSTALL_PATH/docs/tailscale.md"
  echo "  3. (If you set up Watch+the Personal Sensor Layer) Install the phone-side companion app:"
  echo "       see $INSTALL_PATH/docs/watch-setup.md"
  echo "  4. Send a test message to your assistant via Telegram or the browser UI."
  echo ""
  if [[ -d "$HOME/Desktop/Pandoras Box -- Assistant.app" ]]; then
    echo "  Click ${C_BOLD}'Pandoras Box -- Assistant'${C_RESET} on your Desktop to open"
    echo "  your Personal Assistant."
    echo ""
  fi
}

advance_step() {
  STEP_CURRENT=$((STEP_CURRENT + 1))
  echo ""
  echo "  ─────────────────────────────────────────────────"
  echo "  Step ${STEP_CURRENT} of ${STEP_TOTAL}: $1"
  echo "  ─────────────────────────────────────────────────"
  echo ""
}

# run_system_check is defined here (at end of file to access all sourced vars).
# Stronger than the previous version -- for every service with an HTTP surface,
# we curl the port and assert a response. launchctl-registered-but-bind-failed
# is the false-positive class to catch at install time -- a daemon may be
# registered with launchctl but bind-fail on the configured port.
run_system_check() {
  section_header "Final system check"
  echo "  Checking that all services started correctly..."
  echo ""

  local all_pass=true

  # --- structural checks --------------------------------------------------
  if [[ -d "$INSTALL_PATH" ]]; then
    check_pass "Core system: installation directory exists"
  else
    check_fail "Core system: $INSTALL_PATH not found"; all_pass=false
  fi

  if [[ -f "$INSTALL_PATH/theme.conf" ]]; then
    local admin_name=$(grep '^ADMIN_NAME=' "$INSTALL_PATH/theme.conf" | cut -d= -f2 | tr -d '"')
    check_pass "Theme: $admin_name"
  else
    check_fail "Theme: theme.conf not found"; all_pass=false
  fi

  # --- HTTP-surface checks (curl, not just launchctl) ---------------------
  # Each check: (a) label is loaded in launchctl, AND (b) port responds.
  # Both must be true; either alone is insufficient.
  _check_http_service() {
    local label="$1"
    local pretty="$2"
    local env_file="$3"
    local port_var="$4"
    local default_port="$5"
    local optional="${6:-no}"   # "yes" = just warn, don't fail all_pass

    # Is the service registered?
    if ! launchctl list 2>/dev/null | grep -q "$label"; then
      if [[ "$optional" == "yes" ]]; then
        info_msg "$pretty: not installed (skipped)"
      else
        warn_msg "$pretty: not registered with launchctl"
        all_pass=false
      fi
      return
    fi

    # Resolve port from env file (if exists), else use default.
    local port="$default_port"
    if [[ -f "$env_file" ]]; then
      local from_env
      from_env=$(grep "^${port_var}=" "$env_file" 2>/dev/null | cut -d= -f2 | tr -d '"' || true)
      [[ -n "$from_env" ]] && port="$from_env"
    fi

    # Curl the port. Accept any 2xx/3xx as proof-of-life; 401/403 also fine
    # (means it's running and auth-gated, which is what we want).
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://localhost:$port/" -k 2>/dev/null \
        || curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$port/" 2>/dev/null \
        || echo "000")
    case "$code" in
      2*|3*|401|403)
        check_pass "$pretty: registered AND responding on :$port (HTTP $code)"
        ;;
      *)
        warn_msg "$pretty: launchctl-registered but port $port not responding (HTTP $code) -- bind failed?"
        all_pass=false
        ;;
    esac
  }

  # Cron-only services (no HTTP) -- fall back to launchctl-only check.
  _check_cron_service() {
    local label="$1" pretty="$2" optional="${3:-no}"
    if launchctl list 2>/dev/null | grep -q "$label"; then
      check_pass "$pretty: registered (cron-driven, no HTTP surface)"
    else
      if [[ "$optional" == "yes" ]]; then
        info_msg "$pretty: not installed (skipped)"
      else
        warn_msg "$pretty: not registered"; all_pass=false
      fi
    fi
  }

  # Personal Assistant -- always installed
  _check_http_service \
    "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.muse" \
    "Personal Assistant" \
    "$INSTALL_PATH/muse/.env" "MUSE_PORT" "8800"

  # Dashboard (if installed)
  _check_http_service \
    "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.dashboard" \
    "Dashboard" \
    "$INSTALL_PATH/dashboard/.env" "DASHBOARD_PORT" "8181" "yes"

  # Docs server (if installed)
  _check_http_service \
    "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.docs-server" \
    "Docs server" \
    "$INSTALL_PATH/docs-server/.env" "DOCS_PORT" "8485" "yes"

  # Terminal (if installed)
  _check_http_service \
    "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.terminal" \
    "Browser terminal" \
    "$INSTALL_PATH/terminal/.env" "TERMINAL_PORT" "8484" "yes"

  # Admin lite (if installed)
  _check_http_service \
    "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.admin-lite" \
    "Admin Lite" \
    "$INSTALL_PATH/admin-lite/.env" "ADMIN_LITE_PORT" "8488" "yes"

  # the Content Classifier (if installed) -- localhost-only sidecar
  _check_http_service \
    "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.content-classifier" \
    "the Content Classifier" \
    "$INSTALL_PATH/content-classifier/.env" "CONTENT_CLASSIFIER_PORT" "8487" "yes"

  # Cron-only services
  _check_cron_service "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.argus"  "Security overseer (Argus)"
  _check_cron_service "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.self-improvement" "the Self-Improvement Pipeline" "yes"
  _check_cron_service "${LAUNCHDAEMON_PREFIX:-com.pandoras-box}.backup" "Encrypted backups"        "yes"

  # --- environment checks -------------------------------------------------
  if command -v claude &>/dev/null && claude --print --max-output-tokens 5 "ok" >/dev/null 2>&1; then
    check_pass "Claude CLI: signed in"
  else
    warn_msg "Claude CLI: not signed in -- run 'claude /login' to fix"
  fi

  if command -v tailscale &>/dev/null && tailscale status &>/dev/null 2>&1; then
    check_pass "Tailscale: connected"
  else
    info_msg "Tailscale: not connected (skip if you don't want mobile access)"
  fi

  if [[ -f "$INSTALL_PATH/certs/server.crt" ]]; then
    check_pass "Certificates: server certificate present"
  else
    warn_msg "Certificates: not found -- HTTPS connections may not work"
  fi

  if [[ -f "$INSTALL_PATH/secrets/age-backup-pubkey.txt" ]]; then
    check_pass "Backups: encryption key configured"
  else
    info_msg "Backups: not configured (optional)"
  fi

  echo ""
  if [[ "$all_pass" == "true" ]]; then
    success_msg "All core checks passed. Your system is running."
  else
    warn_msg "Some checks did not pass. See above for details."
    echo "  This may be normal if some services need a moment to start."
    echo "  Wait 30 seconds and run: launchctl list | grep pandoras-box"
  fi
  echo ""
  press_enter_to_continue
}

# Entry point -- runs after every function (including run_system_check) is defined.
main "$@"
