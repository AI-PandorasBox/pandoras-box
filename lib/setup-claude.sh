# =============================================================================
# setup-claude.sh -- Anthropic Claude install + authentication
# REQUIRED -- every agent in the system uses Claude. Without this, the
# Personal Assistant, the per-company agents, and the admin agent cannot
# reason about anything.
# =============================================================================

run_claude_install() {
  section_header "Anthropic Claude (REQUIRED)"

  # In dry-run, skip the install + auth dance entirely -- it depends on
  # interactive browser sign-in or a live API key that doesn't belong in CI.
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] Claude install + auth skipped."
    export PBOX_CLAUDE_AUTH_MODE="dry-run-skipped"
    return 0
  fi

  echo "  Pandoras Box uses Anthropic's Claude as the reasoning model for every"
  echo "  agent on the system. This step installs the Claude CLI (if not present)"
  echo "  and configures authentication."
  echo ""
  echo "  Two authentication paths -- choose one:"
  echo ""
  echo "  ${C_BOLD}A) Subscription (Claude Pro or Claude Pro Max)${C_RESET}  [recommended]"
  echo "     Browser sign-in once via the Claude CLI. Usage is covered by the"
  echo "     monthly subscription -- no per-token billing, no surprise bill."
  echo "     Pro: ~ £18/month   Pro Max: ~ £40/month."
  echo ""
  echo "  ${C_BOLD}B) API key${C_RESET}  [pay-per-use]"
  echo "     Paste an Anthropic API key. Charged per token used."
  echo "     Sensible for very low usage or for keys you already have."
  echo ""

  # ---- Step 1: detect or install the Claude CLI -----------------------------
  if command -v claude &>/dev/null; then
    local cli_ver
    cli_ver=$(claude --version 2>/dev/null | head -1 || echo "(version unknown)")
    check_pass "Claude CLI already installed: $cli_ver"
  else
    info_msg "Claude CLI not detected. Installing via npm..."
    if ! command -v npm &>/dev/null; then
      error_msg "npm not found. Install Node.js (and npm) first."
      [[ "$PBOX_OS" == Darwin ]] && info_msg "  macOS: brew install node" \
        || info_msg "  Linux: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
      return 1
    fi
    # macOS Homebrew node has a user-writable global prefix; Linux (apt/NodeSource)
    # uses a root-owned prefix (/usr) so the global install needs sudo. -H keeps
    # root's HOME so the npm cache does not land root-owned in the operator's home.
    local -a NPM_GI
    if [[ "$PBOX_OS" == Darwin ]]; then
      NPM_GI=(npm install -g @anthropic-ai/claude-code)
    else
      NPM_GI=(sudo -H npm install -g @anthropic-ai/claude-code)
    fi
    if ! "${NPM_GI[@]}"; then
      error_msg "npm install of @anthropic-ai/claude-code failed."
      info_msg  "Try manually: ${NPM_GI[*]}"
      info_msg  "Or see https://docs.claude.com/en/docs/claude-code/installation"
      return 1
    fi
    check_pass "Claude CLI installed."
  fi

  # ---- Step 2: skip if already authenticated --------------------------------
  if [[ -d "$HOME/.claude" ]] && [[ -f "$HOME/.claude/.credentials.json" || -f "$HOME/.claude/auth.json" ]]; then
    check_pass "Claude appears already authenticated (~/.claude credentials present)."
    prompt_yes_no "Re-authenticate anyway?" reauth_choice "no"
    if [[ "$reauth_choice" != "yes" ]]; then
      export PBOX_CLAUDE_AUTH_MODE="${PBOX_CLAUDE_AUTH_MODE:-existing}"
      success_msg "Using existing Claude authentication."
      return 0
    fi
  fi

  # ---- Step 3: pick auth mode -----------------------------------------------
  local mode=""
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    # Default to subscription path in dry-run -- it doesn't need an API call.
    mode="${PBOX_DRY_RUN_CLAUDE_MODE:-subscription}"
    info_msg "[DRY-RUN] Claude auth mode auto-set to '$mode' (override with PBOX_DRY_RUN_CLAUDE_MODE=api-key)"
  else
    while [[ -z "$mode" ]]; do
      read -rp "  Choose authentication path  [A=Subscription, B=API key]: " mode
      case "$mode" in
        [Aa]*) mode="subscription" ;;
        [Bb]*) mode="api-key" ;;
        *)     warn_msg "Pick A or B."; mode="" ;;
      esac
    done
  fi

  if [[ "$mode" == "subscription" ]]; then
    run_claude_subscription_auth
  else
    run_claude_api_key_auth
  fi
}

# -----------------------------------------------------------------------------
# Subscription (Pro / Pro Max) path -- browser sign-in via the CLI.
# -----------------------------------------------------------------------------
run_claude_subscription_auth() {
  echo ""
  info_msg "Subscription path selected."
  echo ""
  echo "  To complete sign-in:"
  echo "    1. Open a SEPARATE terminal window."
  echo "    2. Run:  ${C_BOLD}claude${C_RESET}"
  echo "    3. Choose 'Sign in with Claude account' at the menu."
  echo "    4. A browser window will open -- sign in with your Claude Pro / Pro Max account."
  echo "    5. Return to that terminal once it says 'Logged in'."
  echo "    6. Then come back here and press Enter."
  echo ""
  press_enter_to_continue

  # Verify by checking for credentials on disk.
  if [[ -d "$HOME/.claude" ]] && [[ -f "$HOME/.claude/.credentials.json" || -f "$HOME/.claude/auth.json" ]]; then
    check_pass "Claude subscription authenticated."
    export PBOX_CLAUDE_AUTH_MODE="subscription"
    return 0
  else
    warn_msg "Could not detect Claude credentials at ~/.claude/."
    warn_msg "If sign-in did not complete, re-run this installer (completed steps are skipped)."
    prompt_yes_no "Continue anyway (you'll need to authenticate before any agent runs)?" cont "no"
    if [[ "$cont" != "yes" ]]; then
      return 1
    fi
    export PBOX_CLAUDE_AUTH_MODE="subscription-pending"
    return 0
  fi
}

# -----------------------------------------------------------------------------
# API-key path -- paste a key, validate against the Anthropic API, store it.
# -----------------------------------------------------------------------------
run_claude_api_key_auth() {
  echo ""
  info_msg "API-key path selected."
  echo ""
  echo "  1. Go to https://console.anthropic.com/settings/keys"
  echo "  2. Sign in (or create an account)"
  echo "  3. Click 'Create Key' -> name it 'Pandoras Box' -> Create"
  echo "  4. Copy the key (starts with 'sk-ant-')"
  echo ""
  press_enter_to_continue

  local key=""
  while [[ -z "$key" ]]; do
    read -rsp "  Paste your Anthropic API key (input hidden): " key
    echo ""
    if [[ ! "$key" =~ ^sk-ant-[A-Za-z0-9_\-]{20,}$ ]]; then
      warn_msg "That does not look like an Anthropic key (should start with 'sk-ant-'). Try again or press Ctrl+C to skip."
      key=""
    fi
  done

  # Validate against the API with a minimal test call.
  info_msg "Validating key against the Anthropic API..."
  local http_code
  http_code=$(curl -s -o /tmp/pbox-claude-validate.json -w '%{http_code}' \
    --max-time 20 \
    https://api.anthropic.com/v1/messages \
    -H "x-api-key: $key" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{"model":"claude-haiku-4-5","max_tokens":4,"messages":[{"role":"user","content":"hi"}]}' \
    2>/dev/null || echo "000")

  if [[ "$http_code" != "200" ]]; then
    error_msg "Anthropic API rejected the key (HTTP $http_code)."
    if [[ -f /tmp/pbox-claude-validate.json ]]; then
      info_msg "Response: $(head -c 200 /tmp/pbox-claude-validate.json)"
    fi
    prompt_yes_no "Try a different key?" retry "yes"
    if [[ "$retry" == "yes" ]]; then
      run_claude_api_key_auth
      return $?
    fi
    return 1
  fi
  rm -f /tmp/pbox-claude-validate.json
  check_pass "Anthropic API key validated."

  # Store the key via the portability layer (macOS Keychain on Darwin, a 600
  # file under $INSTALL_PATH/.secrets on Linux) + write to $INSTALL_PATH/.env-claude
  # (referenced by agents).
  if pbox_store_secret "pbox-anthropic-api-key" "$key"; then
    check_pass "Key stored in OS secret store (service: pbox-anthropic-api-key)."
  else
    warn_msg "Could not write to OS secret store -- key will only live in the .env file."
  fi

  sudo mkdir -p "$INSTALL_PATH"
  sudo bash -c "cat > '$INSTALL_PATH/.env-claude'" <<ENVEOF
# Pandoras Box -- Anthropic Claude API key
# Sourced by agents that need direct API access.
ANTHROPIC_API_KEY=$key
ENVEOF
  sudo chmod 600 "$INSTALL_PATH/.env-claude"
  check_pass "Key written to $INSTALL_PATH/.env-claude (chmod 600)."

  export PBOX_CLAUDE_AUTH_MODE="api-key"
  export ANTHROPIC_API_KEY="$key"
  return 0
}
