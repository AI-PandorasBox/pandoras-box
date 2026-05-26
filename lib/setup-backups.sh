# =============================================================================
# setup-backups.sh -- Encrypted offsite-ready backups (LaunchDaemon flavour)
#
# Marker: _BACKUPS_LAUNCHDAEMON_V1
#
# Architecture (2026-05-21+):
#   - Backup runs as ROOT via a LaunchDaemon (not a user LaunchAgent). This is
#     necessary on macOS Tahoe -- TCC silently blocks user LaunchAgents from
#     reading ~/Desktop and ~/Documents, which made the previous installer's
#     backups zero-byte on a non-trivial fraction of installs.
#   - Scripts live under /Users/Shared/pandoras-box-backup-scripts/ (root:wheel
#     755). Env file at /usr/local/etc/pandoras-box-backup.env (root:wheel 600).
#   - Per-component size assertion -- 0-byte components refuse to update the
#     `latest` symlink. Daily [OK]/[FAIL] email (opt-out) via SMTP relay.
#   - B2 offsite remains opt-in. Local-only is the default.
#
# This module REQUIRES sudo. install.sh + pbox-setup.sh now prompt the user
# before kicking off this function.
# =============================================================================

run_backups_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi

  print_module_info_card \
    "Encrypted backups" \
    "Every night at 03:30, a root LaunchDaemon dumps your CRM databases, agent stores, configs, and selected directories into a single tarball, encrypts it with age, and writes it to /Users/Shared/pandoras-box-backups/. A per-component size assertion refuses to update the 'latest' symlink if any piece came back empty. An optional daily email reports [OK] or [FAIL]." \
    "Sudo password (for the LaunchDaemon install). Optionally: SMTP creds for the daily email, Backblaze B2 creds for offsite mirroring." \
    "Free locally. Optional B2 offsite tier ~\$0.005/GB/month." \
    "~4 minutes"

  prompt_yes_no "Install encrypted backups?" backup_choice "yes"
  if [[ "$backup_choice" != "yes" ]]; then
    info_msg "Skipping backups setup. You can re-run this later: sudo bash $INSTALL_PATH/scripts/setup-backups.sh"
    return 0
  fi

  echo ""
  warn_msg "The backups module needs sudo for LaunchDaemon install (/Library/LaunchDaemons/, /Users/Shared/, /usr/local/etc/)."
  echo ""
  # Cache sudo so we don't re-prompt per command.
  sudo -v || error_exit "sudo required for backup install"

  echo ""
  info_msg "Step 1 of 7: Install age (offline encryption tool)"
  if ! command -v age &>/dev/null; then
    if ! brew install age 2>&1 | tail -3; then
      error_exit "Could not install age via Homebrew. Resolve and re-run."
    fi
  fi
  check_pass "age installed: $(age --version 2>&1 | head -1)"

  echo ""
  info_msg "Step 2 of 7: Generate backup encryption keypair"
  local PUBKEY_FILE="/usr/local/etc/pandoras-box-backup-pubkey.txt"
  local TMP_PRIVKEY; TMP_PRIVKEY=$(mktemp)
  local TMP_PUBKEY="$TMP_PRIVKEY.pub"
  local TMP_FULL="$TMP_PRIVKEY.full"
  trap 'rm -f "$TMP_PRIVKEY" "$TMP_PUBKEY" "$TMP_FULL"' EXIT

  if sudo test -f "$PUBKEY_FILE"; then
    info_msg "Public key already exists at $PUBKEY_FILE -- skipping keypair generation."
  else
    age-keygen 2>"$TMP_FULL" >/dev/null || error_exit "age-keygen failed"
    grep '^# public key:' "$TMP_FULL" | awk '{print $4}' > "$TMP_PUBKEY"
    grep '^AGE-SECRET-KEY-'      "$TMP_FULL"            > "$TMP_PRIVKEY"
    sudo cp "$TMP_PUBKEY" "$PUBKEY_FILE"
    sudo chown root:wheel "$PUBKEY_FILE"
    sudo chmod 644        "$PUBKEY_FILE"

    if security add-generic-password \
        -s "pbox-backup-age" \
        -a "$(whoami)" \
        -w "$(cat "$TMP_PRIVKEY")" \
        -U 2>/dev/null; then
      check_pass "Private key stored in macOS Keychain (item 'pbox-backup-age')."
    else
      warn_msg "Could not store private key in Keychain. Saving to ~/Desktop/PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt"
      cp "$TMP_PRIVKEY" "$HOME/Desktop/PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt"
      echo ""
      echo "  ${C_BOLD}MANUAL STEP: copy that Desktop file to a separate device, then DELETE it.${C_RESET}"
      press_enter_to_continue
    fi
    rm -f "$TMP_PRIVKEY" "$TMP_PUBKEY" "$TMP_FULL"
    check_pass "Public key written to $PUBKEY_FILE"
  fi

  echo ""
  info_msg "Step 3 of 7: Off-box recovery copy"
  echo ""
  echo "  ${C_BOLD}Strongly recommended.${C_RESET} If this Mac is lost and you have no off-box copy of"
  echo "  the private key, your backups are unrecoverable. Make a copy now:"
  echo "    1. Print to terminal (you copy by hand to USB / password manager / paper)"
  echo "    2. Skip for now (re-run via: security find-generic-password -s pbox-backup-age -w)"
  echo ""
  prompt_yes_no "Print the private key now?" show_key "no"
  if [[ "$show_key" == "yes" ]]; then
    local key; key=$(security find-generic-password -s "pbox-backup-age" -w 2>/dev/null || echo "")
    if [[ -n "$key" ]]; then
      echo ""
      echo "  ${C_BOLD}── COPY THIS KEY TO A SAFE PLACE ──${C_RESET}"
      echo ""
      echo "    $key"
      echo ""
      echo "  ${C_BOLD}── END KEY ──${C_RESET}"
      echo ""
      press_enter_to_continue
      clear
    fi
  fi

  echo ""
  info_msg "Step 4 of 7: Install backup scripts to /Users/Shared/pandoras-box-backup-scripts/"
  local SCRIPTS_DIR="/Users/Shared/pandoras-box-backup-scripts"
  sudo mkdir -p "$SCRIPTS_DIR"
  sudo install -o root -g wheel -m 755 "$INSTALL_PATH/scripts/pandoras-box-backup.sh"              "$SCRIPTS_DIR/pandoras-box-backup.sh"
  sudo install -o root -g wheel -m 755 "$INSTALL_PATH/scripts/pandoras-box-backup-offsite.sh"      "$SCRIPTS_DIR/pandoras-box-backup-offsite.sh"      || true
  sudo install -o root -g wheel -m 755 "$INSTALL_PATH/scripts/pandoras-box-backup-daily-report.mjs" "$SCRIPTS_DIR/pandoras-box-backup-daily-report.mjs"
  sudo install -o root -g wheel -m 644 "$INSTALL_PATH/scripts/pandoras-box-backup-recovery-template.md" "$SCRIPTS_DIR/RECOVERY-template.md"
  check_pass "Scripts installed to $SCRIPTS_DIR"

  echo ""
  info_msg "Step 5 of 7: Write env file (B2/SMTP optional)"
  local ENV_FILE="/usr/local/etc/pandoras-box-backup.env"
  if ! sudo test -f "$ENV_FILE"; then
    sudo tee "$ENV_FILE" >/dev/null <<ENV
# pandoras-box-backup.env -- written by setup-backups.sh
# root:wheel 600. Edit with sudo $EDITOR if you add B2 or SMTP later.
AGE_PUBKEY_FILE="$PUBKEY_FILE"
BACKUP_VOL="${PBOX_BACKUP_VOL:-/Users/Shared/pandoras-box-backups}"
KEEP_DAYS=60
MIN_BLOB_SIZE_BYTES=$((100 * 1024 * 1024))
# B2 offsite (opt-in -- set these to enable the offsite LaunchDaemon)
# B2_KEYID=
# B2_APPKEY=
# B2_BUCKET=pandoras-box-backups
# B2_RETENTION_DAYS=14
# SMTP daily-report (opt-in -- set these to enable the [OK]/[FAIL] email)
# SMTP_HOST=
# SMTP_USER=
# SMTP_PASS=
# REPORT_EMAIL_TO=
ENV
    sudo chown root:wheel "$ENV_FILE"
    sudo chmod 600        "$ENV_FILE"
    check_pass "Env file created at $ENV_FILE (B2 + SMTP commented out)"
  else
    info_msg "Env file already exists at $ENV_FILE -- not overwriting."
  fi

  prompt_yes_no "Configure Backblaze B2 offsite mirroring now?" b2_choice "no"
  if [[ "$b2_choice" == "yes" ]]; then
    echo "B2 setup: enter your B2 KeyID, AppKey, and bucket name."
    read -r -p "  B2 KeyID:   " b2_keyid
    read -r -s -p "  B2 AppKey:  " b2_appkey; echo
    read -r -p "  B2 bucket:  " b2_bucket
    sudo bash -c "{
      sed -i '' 's|^# B2_KEYID=.*$|B2_KEYID=\"$b2_keyid\"|'                \"$ENV_FILE\"
      sed -i '' 's|^# B2_APPKEY=.*$|B2_APPKEY=\"$b2_appkey\"|'              \"$ENV_FILE\"
      sed -i '' 's|^# B2_BUCKET=.*$|B2_BUCKET=\"$b2_bucket\"|'              \"$ENV_FILE\"
      sed -i '' 's|^# B2_RETENTION_DAYS=.*$|B2_RETENTION_DAYS=14|'          \"$ENV_FILE\"
    }"
    check_pass "B2 creds written to $ENV_FILE"
  fi

  prompt_yes_no "Configure daily [OK]/[FAIL] email report?" smtp_choice "no"
  if [[ "$smtp_choice" == "yes" ]]; then
    read -r -p "  SMTP host (e.g. smtp.gmail.com):   " s_host
    read -r -p "  SMTP user:                          " s_user
    read -r -s -p "  SMTP password:                      " s_pass; echo
    read -r -p "  Send to email:                       " s_to
    sudo bash -c "{
      sed -i '' 's|^# SMTP_HOST=.*$|SMTP_HOST=\"$s_host\"|'                  \"$ENV_FILE\"
      sed -i '' 's|^# SMTP_USER=.*$|SMTP_USER=\"$s_user\"|'                  \"$ENV_FILE\"
      sed -i '' 's|^# SMTP_PASS=.*$|SMTP_PASS=\"$s_pass\"|'                  \"$ENV_FILE\"
      sed -i '' 's|^# REPORT_EMAIL_TO=.*$|REPORT_EMAIL_TO=\"$s_to\"|'        \"$ENV_FILE\"
    }"
    check_pass "SMTP creds written to $ENV_FILE"
  fi

  echo ""
  info_msg "Step 6 of 7: Install LaunchDaemons (system) + daily-report LaunchAgent (user)"
  local DAEMON="/Library/LaunchDaemons/com.pandoras-box.backup.plist"
  sudo tee "$DAEMON" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandoras-box.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPTS_DIR/pandoras-box-backup.sh</string>
  </array>
  <key>UserName</key><string>root</string>
  <key>GroupName</key><string>wheel</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/pandoras-box-backup-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/pandoras-box-backup-daemon.log</string>
  <key>RunAtLoad</key><false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST
  sudo chown root:wheel "$DAEMON"; sudo chmod 644 "$DAEMON"
  sudo launchctl bootout system/com.pandoras-box.backup 2>/dev/null || true
  sudo launchctl bootstrap system "$DAEMON"
  check_pass "Daily backup LaunchDaemon installed (03:30, root)"

  if [[ "$b2_choice" == "yes" ]]; then
    local OFFSITE_PLIST="/Library/LaunchDaemons/com.pandoras-box.backup-offsite.plist"
    sudo tee "$OFFSITE_PLIST" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandoras-box.backup-offsite</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPTS_DIR/pandoras-box-backup-offsite.sh</string>
  </array>
  <key>UserName</key><string>root</string>
  <key>GroupName</key><string>wheel</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>0</integer>
    <key>Hour</key><integer>1</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/pandoras-box-offsite-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/pandoras-box-offsite-daemon.log</string>
  <key>RunAtLoad</key><false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST
    sudo chown root:wheel "$OFFSITE_PLIST"; sudo chmod 644 "$OFFSITE_PLIST"
    sudo launchctl bootout system/com.pandoras-box.backup-offsite 2>/dev/null || true
    sudo launchctl bootstrap system "$OFFSITE_PLIST"
    check_pass "Offsite (B2) LaunchDaemon installed (Sunday 01:00, root)"
  fi

  if [[ "$smtp_choice" == "yes" ]]; then
    local REPORT_PLIST="$HOME/Library/LaunchAgents/com.pandoras-box.backup-daily-report.plist"
    cat > "/tmp/pandoras-box-backup-daily-report.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandoras-box.backup-daily-report</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PBOX_NODE_BIN:-/usr/local/bin/node}</string>
    <string>$SCRIPTS_DIR/pandoras-box-backup-daily-report.mjs</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/pandoras-box-backup-daily-report.log</string>
  <key>StandardErrorPath</key><string>/tmp/pandoras-box-backup-daily-report.log</string>
</dict>
</plist>
PLIST
    mv "/tmp/pandoras-box-backup-daily-report.plist" "$REPORT_PLIST"
    launchctl unload "$REPORT_PLIST" 2>/dev/null || true
    launchctl load   "$REPORT_PLIST"
    check_pass "Daily-report LaunchAgent installed (07:00 user)"
  fi

  echo ""
  info_msg "Step 7 of 7: Full Disk Access pre-flight (TCC)"
  echo ""
  echo "  ${C_BOLD}macOS Tahoe blocks root daemons from reading ~/Desktop and ~/Documents by default.${C_RESET}"
  echo "  Without an explicit Full Disk Access grant to /bin/bash, those parts of your backup"
  echo "  will be empty. Grant FDA now so the first scheduled run is complete:"
  echo ""
  echo "    1. System Settings → Privacy & Security → Full Disk Access"
  echo "    2. Click '+' and add /bin/bash"
  echo "    3. Make sure the toggle is on"
  echo ""
  prompt_yes_no "Open the Full Disk Access pane now?" fda_open "yes"
  if [[ "$fda_open" == "yes" ]]; then
    open 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' || true
    echo ""
    echo "  When you have granted FDA to /bin/bash, press Enter to continue."
    press_enter_to_continue
  else
    warn_msg "Skipping FDA grant. Your first backup may have empty Desktop/Documents tarballs. The daily email will show [FAIL] until granted."
  fi

  echo ""
  success_msg "Encrypted backups installed."
  echo ""
  echo "  Daily backup:        03:30 UK -> /Users/Shared/pandoras-box-backups/<DATE>.tar.age"
  [[ "$b2_choice"   == "yes" ]] && echo "  Sunday B2 mirror:    01:00 UK -> Backblaze B2 ($b2_bucket)"
  [[ "$smtp_choice" == "yes" ]] && echo "  Daily email:         07:00 UK -> $s_to"
  echo "  Public key:          /usr/local/etc/pandoras-box-backup-pubkey.txt"
  echo "  Private key:         macOS Keychain ('pbox-backup-age')"
  echo "  Env file:            $ENV_FILE (sudo to edit)"
  echo "  Recovery template:   $SCRIPTS_DIR/RECOVERY-template.md"
  echo ""
  echo "  ${C_BOLD}First scheduled run is tonight at 03:30.${C_RESET} To run manually now:"
  echo "    sudo launchctl kickstart -k system/com.pandoras-box.backup"
  echo ""
  press_enter_to_continue
}
