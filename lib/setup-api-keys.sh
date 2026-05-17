# =============================================================================
# setup-api-keys.sh -- API key collection and validation
# =============================================================================

run_api_key_collection() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  section_header "API keys and service accounts"
  echo "  Pandoras Box needs API keys to connect to AI services."
  echo "  An API key is like a password that lets the software access a service"
  echo "  on your behalf. We will collect each key and test it before continuing."
  echo ""
  echo "  Your keys are stored only on this Mac, in protected files that only"
  echo "  the agent software can read."
  echo ""

  collect_anthropic_key
  run_spend_limits_walkthrough
}

collect_anthropic_key() {
  echo "  --- Anthropic API Key ---"
  echo ""
  echo "  Anthropic makes the Claude AI that powers your agents. You need an"
  echo "  API key to use it."
  echo ""
  echo "  To get your key:"
  echo "  1. Go to: https://console.anthropic.com"
  echo "  2. Sign in or create a free account"
  echo "  3. Click 'API Keys' in the left sidebar"
  echo "  4. Click 'Create Key'"
  echo "  5. Give it a name (e.g. 'Pandoras Box')"
  echo "  6. Copy the key -- it starts with 'sk-ant-'"
  echo ""
  echo "  Note: Anthropic charges per use. A typical month of light usage costs"
  echo "  approximately £5-20 depending on how much you use your agents."
  echo ""

  local key=""
  while true; do
    read -rsp "  Paste your Anthropic API key (input hidden): " key
    echo ""
    if [[ -z "$key" ]]; then
      warn_msg "Key cannot be empty. Please try again."
      continue
    fi
    if [[ ! "$key" =~ ^sk-ant- ]]; then
      warn_msg "That does not look like an Anthropic key (should start with 'sk-ant-'). Please check and try again."
      continue
    fi
    echo "  Testing your key..."
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "x-api-key: $key" \
      -H "anthropic-version: 2023-06-01" \
      "https://api.anthropic.com/v1/models" 2>/dev/null || echo "000")
    if [[ "$response" == "200" ]]; then
      check_pass "Anthropic API key: valid"
      export ANTHROPIC_API_KEY="$key"
      break
    elif [[ "$response" == "401" ]]; then
      check_fail "Anthropic API key: rejected (invalid key)"
      echo "  The key was not accepted. Please check you copied it correctly."
    elif [[ "$response" == "000" ]]; then
      check_fail "Could not reach api.anthropic.com"
      echo "  Please check your internet connection and try again."
    else
      check_fail "Unexpected response code: $response"
      echo "  Please try again. If the problem persists, check console.anthropic.com."
    fi
  done
  echo ""
}

run_spend_limits_walkthrough() {
  section_header "Setting up spending limits (required)"
  echo "  IMPORTANT: Before your agents start running, you must set spending"
  echo "  limits on your Anthropic account."
  echo ""
  echo "  A spending limit is a cap -- Anthropic will stop your agents from"
  echo "  making more API calls once the limit is reached. This prevents"
  echo "  unexpected bills if something goes wrong."
  echo ""
  echo "  Without a spending limit, a misconfigured agent could run up a"
  echo "  large bill in a short time."
  echo ""

  read -rp "  Have you already set spending limits on your Anthropic account? (yes/no) [no]: " already_set
  already_set="${already_set:-no}"

  if [[ "$already_set" =~ ^[Yy] ]]; then
    success_msg "Spending limits confirmed as already set."
    echo ""
    return
  fi

  echo "  --- How to set spending limits ---"
  echo ""
  echo "  1. Open this page in your browser:"
  echo "     https://console.anthropic.com/settings/limits"
  echo ""
  echo "  2. You will see two limit fields:"
  echo ""
  echo "     Hard limit: Anthropic STOPS all API calls when this is reached."
  echo "     Soft limit: You receive an EMAIL WARNING when this is reached."
  echo ""

  # Calculate recommended limits based on company count
  local company_count="${COMPANY_COUNT:-1}"
  local soft_rec hard_rec
  if [[ "$company_count" -le 1 ]]; then
    soft_rec=20; hard_rec=50
  elif [[ "$company_count" -le 3 ]]; then
    soft_rec=40; hard_rec=100
  else
    soft_rec=80; hard_rec=200
  fi

  echo "  3. Recommended starting values for your setup ($company_count company/companies):"
  echo "     Soft limit: \$$soft_rec / month"
  echo "     Hard limit: \$$hard_rec / month"
  echo ""
  echo "     You can adjust these at any time as you learn your actual usage."
  echo ""
  echo "  4. Click Save."
  echo ""
  press_enter_to_continue
  echo ""
  read -rp "  Have you set your spending limits now? (yes/no): " limits_set
  if [[ ! "$limits_set" =~ ^[Yy] ]]; then
    warn_msg "Spending limits not confirmed. We strongly recommend setting them before continuing."
    echo "  You can set them now at: https://console.anthropic.com/settings/limits"
    echo "  Then press Return to continue."
    press_enter_to_continue
  else
    success_msg "Spending limits set. Your account is protected."
  fi
  echo ""
}
