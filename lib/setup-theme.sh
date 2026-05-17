# _A6_1_NARRATIVE_SCRUB_V1
# =============================================================================
# setup-theme.sh -- Theme selection and theme.conf writer
# =============================================================================

THEMES_DIR="${SETUP_DIR}/config"

run_theme_selection() {
  section_header "Choose your system theme"
  echo "  The theme sets the names used throughout your system -- in the"
  echo "  admin interface, notifications, and documentation."
  echo ""
  echo "  All themes are identical in functionality. The only difference"
  echo "  is the names used."
  echo ""
  # _A2_INSTALLER_AND_GUIDES_V1 -- theme set aligned with the public 7-pack lineup + Plain default
  # _A5_INSTALLER_UX_V1 -- one-line examples of what each theme renders in chat
  echo "  1) Indian       -- Indra, Saraswati, Yama"
  echo "                     e.g. \"Saraswati is monitoring 2 inboxes.\""
  echo "  2) Norse        -- Odin, Frigg, Heimdall"
  echo "                     e.g. \"Frigg is monitoring 2 inboxes.\""
  echo "  3) Roman        -- Jupiter, Minerva, Janus"
  echo "                     e.g. \"Minerva is monitoring 2 inboxes.\""
  echo "  4) Egyptian     -- Ra, Thoth, Anubis"
  echo "                     e.g. \"Thoth is monitoring 2 inboxes.\""
  echo "  5) Japanese     -- Amaterasu, Benzaiten, Tsukuyomi"
  echo "                     e.g. \"Benzaiten is monitoring 2 inboxes.\""
  echo "  6) Yoruba       -- Olodumare, Yemoja, Obatala"
  echo "                     e.g. \"Yemoja is monitoring 2 inboxes.\""
  echo "  7) Mesopotamian -- Anu, Enki, Marduk"
  echo "                     e.g. \"Enki is monitoring 2 inboxes.\""
  echo "  8) Plain        -- Admin, Assistant, Oversight       [default]"
  echo "                     e.g. \"Assistant is monitoring 2 inboxes.\""
  echo "  9) Custom       -- you choose every name"
  echo ""
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    theme_choice="${PBOX_DRY_RUN_THEME:-8}"   # Plain default in dry-run
    info_msg "[DRY-RUN] theme auto-picked: $theme_choice (override with PBOX_DRY_RUN_THEME=<1-9>)"
  else
    read -rp "  Enter a number [default: 8]: " theme_choice
    theme_choice="${theme_choice:-8}"   # _A2_INSTALLER_AND_GUIDES_V1 -- Plain is the default
  fi

  local theme_file=""
  # _A2_INSTALLER_AND_GUIDES_V1
  case "$theme_choice" in
    1) theme_file="theme-indian.conf" ;;
    2) theme_file="theme-norse.conf" ;;
    3) theme_file="theme-roman.conf" ;;
    4) theme_file="theme-egyptian.conf" ;;
    5) theme_file="theme-japanese.conf" ;;
    6) theme_file="theme-yoruba.conf" ;;
    7) theme_file="theme-mesopotamian.conf" ;;
    8) theme_file="theme-plain.conf" ;;
    9) theme_file="" ;;
    *) warn_msg "Invalid choice. Using Plain (default)."
       theme_file="theme-plain.conf" ;;
  esac

  sudo mkdir -p "$INSTALL_PATH"

  if [[ -z "$theme_file" ]]; then
    run_custom_theme_setup
  else
    sudo cp "$THEMES_DIR/$theme_file" "$INSTALL_PATH/theme.conf"
    sudo chmod 644 "$INSTALL_PATH/theme.conf"
    # Theme templates hardcode INSTALL_PATH="/opt/pandoras-box". Rewrite to
    # the actual install path so downstream module installers and runtime
    # daemons read a correct path. Critical for non-default install paths
    # and for PBOX_DRY_RUN=1 sandbox runs that rebase INSTALL_PATH.
    sudo sed -i.bak "s|^INSTALL_PATH=.*|INSTALL_PATH=\"$INSTALL_PATH\"|" "$INSTALL_PATH/theme.conf"
    sudo rm -f "$INSTALL_PATH/theme.conf.bak"
    local admin_name
    admin_name=$(grep '^ADMIN_NAME=' "$INSTALL_PATH/theme.conf" | cut -d= -f2 | tr -d '"')
    local personal_ai
    personal_ai=$(grep '^PERSONAL_AI_NAME=' "$INSTALL_PATH/theme.conf" | cut -d= -f2 | tr -d '"')
    success_msg "Theme applied. Your system admin is '$admin_name', your personal AI is '$personal_ai'."
  fi
  echo ""
}

run_custom_theme_setup() {
  echo ""
  echo "  Custom theme setup. Enter a name for each role."
  echo "  (You can change these later by editing $INSTALL_PATH/theme.conf)"
  echo ""

  prompt_with_default "System name (e.g. 'Pandoras Box')" "Pandoras Box" CUSTOM_SYSTEM_NAME
  prompt_with_default "Your admin assistant name (e.g. 'Admin')" "Admin" CUSTOM_ADMIN_NAME
  prompt_with_default "Your personal AI name (e.g. 'Assistant')" "Assistant" CUSTOM_PERSONAL_AI
  prompt_with_default "Security overseer name (e.g. 'Argus')" "Argus" CUSTOM_SECURITY
  prompt_with_default "Alert relay name (e.g. 'Herald')" "Herald" CUSTOM_RELAY
  prompt_with_default "Accent colour (hex, e.g. '#6366f1')" "#6366f1" CUSTOM_ACCENT

  sudo bash -c "cat > '$INSTALL_PATH/theme.conf'" <<THEMEEOF
SYSTEM_NAME="$CUSTOM_SYSTEM_NAME"
ADMIN_NAME="$CUSTOM_ADMIN_NAME"
PERSONAL_AI_NAME="$CUSTOM_PERSONAL_AI"
SECURITY_OVERSEER="$CUSTOM_SECURITY"
ALERT_RELAY="$CUSTOM_RELAY"
COLOR_ACCENT="$CUSTOM_ACCENT"
COLOR_BACKGROUND="#0a0a0f"
COLOR_TEXT="#e0e0f0"
LAUNCHDAEMON_PREFIX="com.pandoras-box"
INSTALL_PATH="/opt/pandoras-box"
LOG_PREFIX="pandoras-box"
AVATAR_GIF="\${INSTALL_PATH}/assets/avatar-default.gif"
ADMIN_AVATAR_GIF="\${INSTALL_PATH}/assets/avatar-default.gif"
THEMEEOF
  sudo chmod 644 "$INSTALL_PATH/theme.conf"
  success_msg "Custom theme saved."
}
