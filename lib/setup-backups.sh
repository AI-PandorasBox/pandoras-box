# =============================================================================
# setup-backups.sh -- Encrypted offsite-ready backups
# Installs `age`, generates a keypair, stores the private key in macOS Keychain,
# writes the daily backup LaunchAgent + Sunday freshness probe LaunchAgent,
# and writes a recovery instructions file outside the encrypted blob.
# =============================================================================

run_backups_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "Encrypted backups" \
    "Every night, your databases (CRM, agent memory, knowledge stores) and config files are dumped, packaged into a single tarball, and encrypted with age (a modern offline encryption tool). The plaintext is deleted; only the encrypted blob remains. A separate Sunday job verifies the most recent backup is fresh and readable. Recovery instructions are written outside the encrypted blob in plaintext, so you can restore from a fresh OS install with no working Pandoras Box." \
    "Nothing -- the installer generates the encryption key for you and stores it in macOS Keychain. You can optionally save a copy to a separate device or to paper for off-box recovery." \
    "Free. Uses age (Homebrew). The backup volume defaults to /Users/Shared/ -- no cloud charges. Off-box copy is optional and uses your own storage." \
    "~3 minutes"

  prompt_yes_no "Install encrypted backups?" backup_choice "yes"
  if [[ "$backup_choice" != "yes" ]]; then
    info_msg "Skipping backups setup. You can re-run this later: sudo bash $INSTALL_PATH/scripts/setup-backups.sh"
    return 0
  fi

  echo ""
  info_msg "Step 1 of 4: Install age (offline encryption tool)..."
  if ! command -v age &>/dev/null; then
    if ! brew install age 2>&1 | tail -3; then
      error_exit "Could not install age via Homebrew. Resolve and re-run."
    fi
  fi
  check_pass "age installed: $(age --version 2>&1 | head -1)"

  echo ""
  info_msg "Step 2 of 4: Generate backup encryption keypair..."
  local SECRETS_DIR="$INSTALL_PATH/secrets"
  sudo mkdir -p "$SECRETS_DIR"
  sudo chmod 755 "$SECRETS_DIR"
  local PUBKEY_FILE="$SECRETS_DIR/age-backup-pubkey.txt"
  local TMP_PRIVKEY=$(mktemp)
  trap 'rm -f "$TMP_PRIVKEY"' EXIT

  if [[ -f "$PUBKEY_FILE" ]]; then
    info_msg "Public key already exists at $PUBKEY_FILE -- skipping keypair generation."
  else
    age-keygen 2>"$TMP_PRIVKEY.full" | grep "^# public key:" | awk '{print $4}' > "$TMP_PRIVKEY.pub" || {
      error_exit "age-keygen failed."
    }
    grep "^AGE-SECRET-KEY-" "$TMP_PRIVKEY.full" > "$TMP_PRIVKEY"
    sudo cp "$TMP_PRIVKEY.pub" "$PUBKEY_FILE"
    sudo chmod 644 "$PUBKEY_FILE"
    sudo chown "$(id -u):$(id -g)" "$PUBKEY_FILE"

    # Store private key in Keychain (login keychain, current user)
    if security add-generic-password \
      -s "pbox-backup-age" \
      -a "$(whoami)" \
      -w "$(cat "$TMP_PRIVKEY")" \
      -U 2>/dev/null; then
      check_pass "Private key stored in Keychain (item: 'pbox-backup-age')."
    else
      warn_msg "Could not store private key in Keychain. Saving to $TMP_PRIVKEY.SAVE-ME"
      cp "$TMP_PRIVKEY" "$HOME/Desktop/PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt"
      echo ""
      echo "  ${C_BOLD}MANUAL STEP: copy ~/Desktop/PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt"
      echo "  to a separate device, then DELETE the Desktop file.${C_RESET}"
    fi
    rm -f "$TMP_PRIVKEY" "$TMP_PRIVKEY.pub" "$TMP_PRIVKEY.full"
    check_pass "Public key written to $PUBKEY_FILE"
  fi

  echo ""
  info_msg "Step 3 of 4: Off-box recovery copy"
  echo ""
  echo "  ${C_BOLD}Strongly recommended.${C_RESET} If this Mac is lost, stolen, or its disk fails,"
  echo "  the only way to decrypt your backups is the private key. The Keychain"
  echo "  copy is bound to this Mac. You should keep at least one off-box copy."
  echo ""
  echo "  Options:"
  echo "    1. Save to another device (USB stick, password manager, home PC)"
  echo "    2. Print to paper and store in a safe"
  echo "    3. Skip for now (you can do this any time later)"
  echo ""
  prompt_yes_no "Print the private key to this terminal so you can copy it now?" show_key "no"
  if [[ "$show_key" == "yes" ]]; then
    local key
    key=$(security find-generic-password -s "pbox-backup-age" -w 2>/dev/null || echo "")
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
  info_msg "Step 4 of 4: Install backup LaunchAgents..."

  # Daily backup at 03:30
  local DAILY_PLIST="$HOME/Library/LaunchAgents/com.pandoras-box.backup.plist"
  cat > "/tmp/pbox-backup-daily.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandoras-box.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALL_PATH/scripts/pbox-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/pbox-backup.log</string>
  <key>StandardErrorPath</key><string>/tmp/pbox-backup.log</string>
</dict>
</plist>
PLIST
  mv "/tmp/pbox-backup-daily.plist" "$DAILY_PLIST"
  launchctl load "$DAILY_PLIST" 2>/dev/null || true
  check_pass "Daily backup LaunchAgent installed (03:30)."

  # Sunday freshness probe at 07:30
  local PROBE_PLIST="$HOME/Library/LaunchAgents/com.pandoras-box.backup-freshness.plist"
  cat > "/tmp/pbox-backup-freshness.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pandoras-box.backup-freshness</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALL_PATH/scripts/pbox-backup-freshness.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>0</integer>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/pbox-backup-freshness.log</string>
  <key>StandardErrorPath</key><string>/tmp/pbox-backup-freshness.log</string>
</dict>
</plist>
PLIST
  mv "/tmp/pbox-backup-freshness.plist" "$PROBE_PLIST"
  launchctl load "$PROBE_PLIST" 2>/dev/null || true
  check_pass "Sunday freshness probe LaunchAgent installed (07:30)."

  # RECOVERY.md (plaintext, OUTSIDE encrypted blob)
  local BACKUP_VOL="${PBOX_BACKUP_VOL:-/Users/Shared/pandoras-box-backups}"
  sudo mkdir -p "$BACKUP_VOL"
  sudo chmod 755 "$BACKUP_VOL"
  cat > "/tmp/RECOVERY.md" <<RECOVERY
# Pandoras Box -- Backup Recovery

This file is intentionally plaintext (not encrypted) so you can find it
without a working Pandoras Box install.

## What you need to recover

1. The encrypted backup blob: \`<DATE>.tar.age\` in this directory
2. The age private key, in one of these places:
   - macOS Keychain item \`pbox-backup-age\` (current user)
   - Off-box copy you made during install (USB stick, paper, etc.)
   - The Desktop file named \`PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt\`
     (if you saved one)

## Recovery commands

### 1. Get the private key out of Keychain (if available)

\`\`\`bash
security find-generic-password -s "pbox-backup-age" -w > ~/key.txt
\`\`\`

### 2. Decrypt the backup blob

\`\`\`bash
age -d -i ~/key.txt < <BACKUP_FILE>.tar.age | tar -xf -
\`\`\`

### 3. Inspect the contents

The tarball contains:
- \`postgres/\` -- pg_dump files of your CRM databases
- \`sqlite/\` -- copies of agent memory + knowledge stores
- \`config/\` -- environment files (encrypted, contain API keys)
- \`MANIFEST.txt\` -- list of files + sizes + timestamps

### 4. Restore

Restore steps depend on which databases / files you need. Read MANIFEST.txt
first. For Postgres: \`psql -f postgres/<db>.sql\`. For SQLite: \`cp\` to the
correct path with the correct ownership.

## Off-box / disaster recovery

If this Mac is gone:
1. Buy or use another Mac
2. Install Homebrew + age: \`brew install age\`
3. Find your off-box private key copy
4. Decrypt the most recent backup blob with the commands above
5. Reinstall Pandoras Box on the new Mac, then restore data

If you do not have an off-box private key copy and this Mac is gone, the
backups are unrecoverable. The Sunday freshness probe is for catching backup
failures EARLY -- if the probe stops emailing you, investigate immediately.

RECOVERY
  sudo cp "/tmp/RECOVERY.md" "$BACKUP_VOL/RECOVERY.md"
  sudo chmod 644 "$BACKUP_VOL/RECOVERY.md"
  rm -f "/tmp/RECOVERY.md"
  check_pass "RECOVERY.md written to $BACKUP_VOL"

  echo ""
  success_msg "Encrypted backups installed."
  echo ""
  echo "  Daily backup:        03:30 UK -> $BACKUP_VOL/<DATE>.tar.age"
  echo "  Sunday probe:        07:30 UK -> /opt/pandoras-box/.backup-freshness.json"
  echo "  Public key:          $PUBKEY_FILE"
  echo "  Private key:         macOS Keychain ('pbox-backup-age')"
  echo "  Recovery guide:      $BACKUP_VOL/RECOVERY.md"
  echo ""
  press_enter_to_continue
}
