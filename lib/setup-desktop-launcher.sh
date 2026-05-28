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

  # Linux: GNOME 43+ ships without desktop icons. Try to install + enable the
  # 'desktop-icons-ng' (Ding) extension so the ~/Desktop copies actually render.
  # If apt/install/enable fails (package not in repo, headless box, etc), the
  # ~/.local/share/applications launchers still work via Activities.
  if [[ "$PBOX_OS" == Linux ]]; then
    if command -v apt-get &>/dev/null; then
      # Debian package: gnome-shell-extension-desktop-icons-ng (when present).
      # Best-effort: do not fail the install if the package is unavailable.
      sudo apt-get install -y gnome-shell-extension-desktop-icons-ng 2>/dev/null \
        | tail -2 \
        || info_msg "(desktop-icons-ng package not available; launchers still show in Activities)"
    fi
    # Enable for the operator user. gnome-extensions runs as the user, not root.
    local operator
    operator=$(pbox_stat_owner "$INSTALL_PATH" 2>/dev/null || echo "$USER")
    if [[ -n "$operator" && "$operator" != "root" ]]; then
      sudo -u "$operator" -- gnome-extensions enable ding@rastersoft.com 2>/dev/null || true
      sudo -u "$operator" -- gsettings set org.gnome.shell.extensions.ding show-home false 2>/dev/null || true
    fi
  fi

  echo ""
  if [[ "$PBOX_OS" == Linux ]]; then
    # Prominent post-install block: tell the operator exactly where to find them.
    echo "  ${C_BOLD}${C_CYAN}Launchers created. Where to find them:${C_RESET}"
    echo ""
    echo "    ${C_GREEN}1. Activities menu${C_RESET} (the supported GNOME path)"
    echo "       Press the Super key, type 'Pandoras', press Enter."
    echo ""
    echo "    ${C_GREEN}2. App drawer${C_RESET} -- look for 'Pandoras Box Dashboard',"
    echo "       'Pandoras Box Terminal', 'Pandoras Box Assistant'."
    echo ""
    echo "    ${C_GREEN}3. On the desktop${C_RESET} -- only visible if a desktop-icons"
    echo "       extension is enabled (we tried to install it; if absent, log out"
    echo "       and back in once, or use Activities)."
    echo ""
    echo "    ${C_GREEN}4. Files on disk:${C_RESET}"
    echo "       ${C_DIM}~/.local/share/applications/pbox-pandoras-box-*.desktop${C_RESET}"
    echo "       ${C_DIM}~/Desktop/pbox-pandoras-box-*.desktop${C_RESET}"
    echo ""
    echo "    ${C_GREEN}5. Or just browse to the URLs directly:${C_RESET}"
    echo "       ${C_DIM}${DASHBOARD_URL}${C_RESET}  (dashboard)"
    echo "       ${C_DIM}${TERMINAL_URL}${C_RESET}  (terminal)"
    echo "       ${C_DIM}${PA_URL}${C_RESET}  (assistant)"
    echo ""
  else
    info_msg "Note: the first time you click a launcher, the OS may ask if you trust"
    info_msg "it. Allow it."
  fi
  success_msg "Desktop launchers created."
}
