# =============================================================================
# setup-update-check.sh -- Layer 3 of the auto-update mechanism.
#
# Renders + loads a per-install LaunchAgent that runs `pbox-update --check-only
# --quiet` on a weekly cadence. The schedule hour is randomised per-install
# from a stable hash of the hostname so all operators don't simultaneously
# pound the GitHub API on the same minute.
#
# Idempotent: re-running unloads + reloads.
#
# Output:
#   ~/Library/LaunchAgents/com.pandoras-box.update-check.plist
#   $INSTALL_PATH/.update-status.json    (written by pbox-update.sh on each run)
#
# Optional notification via osascript display notification when an update
# becomes available -- one-time operator-permission grant required by macOS.
# =============================================================================

run_update_check_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (LaunchAgent load)"
    return 0
  fi
  section_header "Weekly update check (Layer 3)"

  local update_script="$INSTALL_PATH/scripts/pbox-update.sh"
  [[ -x "$update_script" ]] || { warn_msg "pbox-update.sh missing or non-executable; skipping Layer 3."; return 0; }

  # Put pbox-update on the operator's PATH so `pbox-update --check-only|--apply`
  # works from any terminal, not just the full $INSTALL_PATH/scripts path.
  if sudo ln -sf "$update_script" /usr/local/bin/pbox-update 2>/dev/null; then
    ok "pbox-update is on your PATH (try: pbox-update --check-only)"
  else
    info_msg "pbox-update lives at $update_script (could not symlink to /usr/local/bin)"
  fi

  # The weekly poll is a launchd LaunchAgent below. On Linux this needs a
  # systemd --user timer (not yet in os-compat). Defer it, consistent with the
  # backups + self-improvement schedule deferrals; the pbox-update command above
  # still works for manual checks.
  if [[ "${PBOX_OS:-$(uname -s)}" != Darwin ]]; then
    info_msg "Update-check schedule: Linux support pending (systemd timer); weekly poll not scheduled."
    info_msg "  Run 'pbox-update --check-only' manually, or add your own cron/systemd timer."
    echo ""
    return 0
  fi

  local plist_dir="$HOME/Library/LaunchAgents"
  local plist="$plist_dir/com.pandoras-box.update-check.plist"
  local label="com.pandoras-box.update-check"
  local watcher="$INSTALL_PATH/scripts/pbox-update-notify.sh"

  mkdir -p "$plist_dir"

  # Hash-based per-install hour offset so GitHub API hits spread across
  # the operator population. host id seeds the hash; falls back to 9 if
  # md5 is missing for any reason.
  local hour
  hour="$( (hostname; whoami) | (md5sum 2>/dev/null || md5 2>/dev/null) | head -c 2 | xargs -I{} printf '%d\n' "0x{}" 2>/dev/null )"
  if [[ -z "$hour" || ! "$hour" =~ ^[0-9]+$ ]]; then hour=9; fi
  hour=$(( hour % 24 ))

  # Generate the notifier helper (writes a notification when status changes
  # to update_available).
  cat > "$watcher" <<'NOTIFY'
#!/usr/bin/env bash
# pbox-update-notify -- runs after pbox-update --check-only and posts
# a one-line osascript notification if the latest release tag differs
# from the recorded current_version.
set -euo pipefail
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
STATUS="$INSTALL_PATH/.update-status.json"
[[ -f "$STATUS" ]] || exit 0
CURRENT=$(grep -m1 '"current_version"' "$STATUS" | sed -E 's/.*"current_version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
LATEST=$(grep -m1 '"latest_version"'  "$STATUS" | sed -E 's/.*"latest_version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
[[ "$CURRENT" == "$LATEST" ]] && exit 0
[[ "$CURRENT" == "v0.0.0-dev" ]] && exit 0
[[ "$LATEST" == "unknown" ]]    && exit 0
osascript -e "display notification \"$LATEST is available (you have $CURRENT)\" with title \"Pandora's Box update\"" 2>/dev/null || true
NOTIFY
  chmod +x "$watcher"

  # Plist
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>INSTALL_PATH="$INSTALL_PATH" "$update_script" --check-only --quiet; INSTALL_PATH="$INSTALL_PATH" "$watcher"</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>$hour</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/pbox-update-check.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/pbox-update-check.log</string>
</dict>
</plist>
PLIST

  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist" 2>/dev/null || { warn_msg "launchctl load $plist failed -- LaunchAgent unhealthy"; return 1; }

  check_pass "Weekly update check installed (every Monday $(printf '%02d' "$hour"):00)."
  info_msg  "First-run notification will request macOS notification permission."
  echo ""
}
