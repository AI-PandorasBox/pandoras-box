# =============================================================================
# setup-tailscale.sh -- Tailscale detection, setup guide, and verification
# =============================================================================

run_tailscale_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  # _A5_INSTALLER_UX_V1 -- point operator at the matching setup guide
  print_setup_guide_link "tailscale"
  section_header "Setting up your private network (Tailscale)"
  echo "  Tailscale creates a private, encrypted network between your devices."
  echo "  It means you can access your AI system from your phone or laptop"
  echo "  from anywhere -- without exposing it to the internet."
  echo ""
  echo "  Think of it like a secure tunnel: only your devices can see each other,"
  echo "  and nothing from the internet can reach your system."
  echo ""

  if command -v tailscale &>/dev/null && tailscale status &>/dev/null 2>&1; then
    local ts_hostname
    ts_hostname=$(tailscale status --json 2>/dev/null | /usr/local/bin/node -e \
      "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.Self?.DNSName?.replace(/\\.$/,'') || '')" 2>/dev/null || echo "")
    if [[ -n "$ts_hostname" ]]; then
      check_pass "Tailscale: running ($ts_hostname)"
      export TAILSCALE_HOSTNAME="$ts_hostname"
      success_msg "Tailscale is already set up. Continuing."
      echo ""
      return
    fi
  fi

  echo "  Tailscale is not running yet. Let's set it up now."
  echo ""
  echo "  Step 1: Create a free Tailscale account"
  echo "  ----------------------------------------"
  echo "  Go to: https://tailscale.com"
  echo "  Click 'Get started' and sign in with your Google or GitHub account."
  echo "  (You do not need to create a new password -- just use an existing account.)"
  echo ""
  press_enter_to_continue

  echo "  Step 2: Install Tailscale on this Mac"
  echo "  ----------------------------------------"
  echo "  Go to: https://tailscale.com/download/mac"
  echo "  Download and open the installer (.pkg file)."
  echo "  Click through the installation steps (Next, Agree, Install)."
  echo "  When it finishes, you will see a Tailscale icon appear in your menu bar"
  echo "  (the row of small icons at the top right of your screen)."
  echo ""
  press_enter_to_continue

  echo "  Step 3: Sign in to Tailscale"
  echo "  ----------------------------------------"
  echo "  Click the Tailscale icon in your menu bar."
  echo "  Click 'Log in...'"
  echo "  A browser window will open -- sign in with the same account you just created."
  echo "  Once signed in, come back here and press Return."
  echo ""
  press_enter_to_continue

  echo "  Checking Tailscale..."
  local attempts=0
  while [[ $attempts -lt 10 ]]; do
    if tailscale status &>/dev/null 2>&1; then
      local ts_hostname
      ts_hostname=$(tailscale status --json 2>/dev/null | /usr/local/bin/node -e \
        "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.Self?.DNSName?.replace(/\\.$/,'') || '')" 2>/dev/null || echo "")
      if [[ -n "$ts_hostname" ]]; then
        check_pass "Tailscale: connected ($ts_hostname)"
        export TAILSCALE_HOSTNAME="$ts_hostname"
        break
      fi
    fi
    attempts=$((attempts + 1))
    sleep 2
  done

  if [[ -z "${TAILSCALE_HOSTNAME:-}" ]]; then
    warn_msg "Tailscale does not appear to be running yet."
    echo "  Please make sure you have:"
    echo "  - Installed Tailscale from tailscale.com/download/mac"
    echo "  - Clicked the menu bar icon and signed in"
    echo "  Then press Return to try again."
    press_enter_to_continue
    local ts_hostname
    ts_hostname=$(tailscale status --json 2>/dev/null | /usr/local/bin/node -e \
      "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.Self?.DNSName?.replace(/\\.$/,'') || '')" 2>/dev/null || echo "")
    if [[ -n "$ts_hostname" ]]; then
      check_pass "Tailscale: connected ($ts_hostname)"
      export TAILSCALE_HOSTNAME="$ts_hostname"
    else
      warn_msg "Tailscale still not detected. You can continue and set it up later."
      export TAILSCALE_HOSTNAME="your-server.tail-XXXXXX.ts.net"
    fi
  fi

  echo ""
  echo "  Now install Tailscale on your phone and other devices:"
  echo "  - iPhone/iPad: App Store -> search 'Tailscale' -> install and sign in"
  echo "  - Android: Play Store -> search 'Tailscale' -> install and sign in"
  echo "  - Other Mac: tailscale.com/download/mac"
  echo ""
  echo "  Full guide: docs/tailscale.md"
  echo ""
  press_enter_to_continue
}
