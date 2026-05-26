# =============================================================================
# setup-desktop-launcher.sh -- Desktop .app shortcuts for browser admin
# Creates clickable .app launchers on the Desktop that open the dashboard,
# browser terminal, and personal assistant in the right URLs.
# =============================================================================

run_desktop_launcher_setup() {
  print_module_info_card \
    "Desktop launchers" \
    "Creates clickable .app shortcuts on your Desktop. Three launchers: Dashboard (system status), Terminal (browser-based shell with auth), Personal Assistant (your AI). Each .app is an AppleScript wrapper that opens the right URL in your default browser. Useful so you do not have to remember any URLs or ports -- just click." \
    "Nothing." \
    "Free." \
    "~30 seconds"

  prompt_yes_no "Create Desktop launchers?" dl_choice "yes"
  if [[ "$dl_choice" != "yes" ]]; then
    info_msg "Skipping Desktop launchers."
    return 0
  fi

  local hostname="${TAILSCALE_HOSTNAME:-pandoras-box.local}"
  local DASHBOARD_URL="https://${hostname}:8181"
  local TERMINAL_URL="https://${hostname}:8282"
  local PA_URL="https://${hostname}:${PERSONAL_AI_PORT:-8800}"

  _make_launcher() {
    local name="$1"
    local url="$2"
    local app_path="$HOME/Desktop/${name}.app"
    if [[ -d "$app_path" ]]; then
      info_msg "$name.app already exists -- skipping."
      return 0
    fi
    local script
    script=$(cat <<EOF
on run
    tell application "System Events" to open location "${url}"
end run
EOF
)
    osacompile -o "$app_path" -e "$script" 2>/dev/null || {
      warn_msg "Could not create $name.app. Skipping."
      return 1
    }
    check_pass "Created Desktop launcher: $app_path"
  }

  _make_launcher "Pandoras Box -- Dashboard" "$DASHBOARD_URL"
  _make_launcher "Pandoras Box -- Terminal"  "$TERMINAL_URL"
  _make_launcher "Pandoras Box -- Assistant" "$PA_URL"

  echo ""
  info_msg "Note: the first time you click a launcher, macOS may ask if you trust"
  info_msg "the app. Click Open. The CA certificate must be trusted on this Mac"
  info_msg "(Step 'Security certificates' in this installer) for the URLs to load."
  echo ""
  success_msg "Desktop launchers created."
}
