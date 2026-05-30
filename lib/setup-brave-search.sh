# =============================================================================
# setup-brave-search.sh -- Brave Search API for the Personal Assistant's web tool
# Optional. Without it, the assistant cannot do live web search.
# =============================================================================

run_brave_search_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "Brave Search API" \
    "Live web search for the Personal Assistant. When you ask 'what's the latest on X' or 'who is Y', the assistant calls Brave Search to get current results, then synthesises an answer with sources. Without this, the assistant relies on the AI model's training cutoff and cannot give you current information." \
    "A Brave Search API account (free tier covers normal personal use)." \
    "Free tier: 2,000 queries/month, 1 query/second. Pro: \$3/month for 20k queries. Enterprise plans available for heavy use." \
    "~2 minutes"

  prompt_yes_no "Set up Brave Search now?" brave_choice "yes"
  if [[ "$brave_choice" != "yes" ]]; then
    info_msg "Skipping Brave Search. Web search will be unavailable to the assistant."
    export BRAVE_API_KEY=""
    return 0
  fi

  echo ""
  echo "  1. Go to https://api.search.brave.com/app/dashboard"
  echo "  2. Sign in (Brave account or Google sign-in)"
  echo "  3. Subscribe to the 'Free' plan if you have not already"
  echo "  4. Go to 'API Keys' -> 'Add API Key' -> name it 'Pandoras Box' -> Create"
  echo "  5. Copy the key (starts with 'BSA')"
  echo ""
  press_enter_to_continue

  local key=""
  while [[ -z "$key" ]]; do
    read -rsp "  Paste your Brave Search API key (input hidden): " key
    echo ""
    if [[ ! "$key" =~ ^BSA[A-Za-z0-9_\-]{30,}$ ]]; then
      warn_msg "That does not look like a Brave key (should start with 'BSA'). Try again or press Ctrl+C to skip."
      key=""
    fi
  done

  # Validate
  info_msg "Validating key with Brave Search..."
  if curl -fsSL "https://api.search.brave.com/res/v1/web/search?q=test" \
       -H "X-Subscription-Token: $key" \
       -H "Accept: application/json" \
       -o /tmp/brave.json 2>/dev/null; then
    if grep -q '"web"' /tmp/brave.json 2>/dev/null; then
      check_pass "Key validated."
    else
      warn_msg "Key returned an error. Check the key and try again."
      cat /tmp/brave.json | head -3
      rm -f /tmp/brave.json
      return 1
    fi
    rm -f /tmp/brave.json
  else
    warn_msg "Could not reach Brave Search. Check your internet connection."
    return 1
  fi

  export BRAVE_API_KEY="$key"
  echo ""
  success_msg "Brave Search configured."
  echo ""
}
