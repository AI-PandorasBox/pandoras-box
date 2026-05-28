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

  # Launchers target loopback by default: services bind 127.0.0.1 and serve
  # plain HTTP. Remote access via Tailscale is configured separately and uses
  # different URLs (the Tailscale hostname + cert is for the optional public-
  # mode setup). Using loopback here means the launchers Just Work on the box.
  local DASHBOARD_PORT="${DASHBOARD_PORT:-8181}"
  local TERMINAL_PORT="${TERMINAL_PORT:-8484}"
  local PA_PORT="${PERSONAL_AI_PORT:-8800}"
  local DASHBOARD_URL="http://127.0.0.1:${DASHBOARD_PORT}/"
  local TERMINAL_URL="http://127.0.0.1:${TERMINAL_PORT}/"
  local PA_URL="http://127.0.0.1:${PA_PORT}/"

  # pbox_make_launcher builds a .app on macOS and a .desktop entry on Linux.
  # Name uses single-word separators -- multi-dash forms produced ugly
  # mangled .desktop filenames on Linux.
  pbox_make_launcher "Pandoras Box Dashboard" "$DASHBOARD_URL"
  pbox_make_launcher "Pandoras Box Terminal"  "$TERMINAL_URL"
  pbox_make_launcher "Pandoras Box Assistant" "$PA_URL"

  echo ""
  if [[ "$PBOX_OS" == Linux ]]; then
    info_msg "Linux note: launchers appear in the Activities menu / app drawer."
    info_msg "GNOME 43+ (incl. Debian 13) hides the ~/Desktop folder by default;"
    info_msg "install a 'desktop-icons-ng' extension if you want them on the desktop."
  else
    info_msg "Note: the first time you click a launcher, the OS may ask if you trust"
    info_msg "it. Allow it."
  fi
  echo ""
  success_msg "Desktop launchers created."
}
