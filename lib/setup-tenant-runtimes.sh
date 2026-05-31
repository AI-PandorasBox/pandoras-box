# =============================================================================
# setup-tenant-runtimes.sh -- Per-tenant install of conductor + 3 task agents.
# Called by setup-company.sh after the company dir + service account are set up.
# Renders plist templates per-tenant, installs npm deps per-module, loads
# LaunchDaemons conditionally based on the company .env flags.
# =============================================================================

# install_tenant_runtimes <slug> <service_user>
#
# For the given tenant:
#   - Stages each of conductor / mail-agent / calendar-agent / files-agent into
#     $INSTALL_PATH/<slug>-<role>/
#   - Renders the per-tenant plist for each role from the module template
#   - Runs `npm install` in each module's target dir
#   - Loads the conductor LaunchDaemon always
#   - Loads task-agent LaunchDaemons conditionally per .env flags:
#       MAIL:     iff GOOGLE_CLIENT_ID or MS365_CLIENT_ID set
#       CALENDAR: iff CALENDAR_ENABLED=true
#       FILES:    iff FILES_ENABLED=true
#
# Dry-run honors PBOX_DRY_RUN_ACTIVE=1: skips npm install, launchctl load.
install_tenant_runtimes() {
  local slug="$1"
  local user="${2:-$(stat -f '%Su' "$INSTALL_PATH" 2>/dev/null || echo "$USER")}"
  local base_env="$INSTALL_PATH/$slug/.env"
  local node_bin
  node_bin="$(command -v node)" || { echo "ERROR: node not on PATH" >&2; return 1; }

  echo "[setup-tenant-runtimes] tenant=$slug user=$user node=$node_bin"

  # _CONDUCTOR_GUIDE_V1 -- stage this tenant's operating guide (behaviour +
  # data-integrity + safety rules). The conductor runtime reads <slug>/CLAUDE.md
  # at boot. Staged from the template; never clobber an operator-customised copy.
  local _guide_dst="$INSTALL_PATH/$slug/CLAUDE.md"
  local _guide_tmpl="$INSTALL_PATH/config/conductor-CLAUDE.md.template"
  [[ -f "$_guide_tmpl" ]] || _guide_tmpl="${SETUP_DIR:-$INSTALL_PATH}/config/conductor-CLAUDE.md.template"
  if [[ -f "$_guide_tmpl" && ! -f "$_guide_dst" ]]; then
    sudo mkdir -p "$INSTALL_PATH/$slug"
    sudo cp "$_guide_tmpl" "$_guide_dst"
    sudo chown "${user}:staff" "$_guide_dst" 2>/dev/null || sudo chown "$user" "$_guide_dst" 2>/dev/null || true
    echo "  staged company-agent guide: $_guide_dst"
  fi

  for role in conductor mail calendar files voice voice-call; do
    local module_dir target_dir plist_label plist_src plist_dst
    if [[ "$role" == "conductor" ]]; then
      module_dir="$INSTALL_PATH/modules/conductor"
      target_dir="$INSTALL_PATH/$slug-conductor"
    elif [[ "$role" == "voice-call" ]]; then
      module_dir="$INSTALL_PATH/modules/voice-call"
      target_dir="$INSTALL_PATH/$slug-voice-call"
    else
      module_dir="$INSTALL_PATH/modules/${role}-agent"
      target_dir="$INSTALL_PATH/$slug-${role}"
    fi
    plist_label="${LAUNCHDAEMON_PREFIX}.${slug}-${role}"
    plist_src="$module_dir/runtime/com.pandoras-box.tenant-${role}.plist.template"
    plist_dst="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/${plist_label}.plist"

    [[ -d "$module_dir/runtime" ]] || { echo "  SKIP $role: $module_dir not found"; continue; }
    [[ -f "$plist_src" ]] || { echo "  SKIP $role: $plist_src not found"; continue; }

    echo "  staging $role -> $target_dir"
    sudo mkdir -p "$target_dir"
    sudo cp -R "$module_dir/runtime/." "$target_dir/"
    sudo chown -R "${user}:staff" "$target_dir" 2>/dev/null || true
    sudo chmod 755 "$target_dir"/*.mjs 2>/dev/null || true

    if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
      echo "  (dry-run) skipping npm install for $role"
    else
      echo "  npm install in $target_dir (pinned per package.json)"
      (cd "$target_dir" && sudo -u "$user" npm install --omit=dev --no-audit --no-fund >/dev/null) \
        || { echo "  WARN: npm install failed for $role"; }
    fi

    # Decide whether this role should actually start (same rule on every OS).
    local load_it=0
    case "$role" in
      conductor)  load_it=1 ;;
      mail)       [[ -f "$base_env" ]] && grep -qE '^(GOOGLE_CLIENT_ID|MS365_CLIENT_ID)=' "$base_env" && load_it=1 ;;
      calendar)   [[ -f "$base_env" ]] && grep -q   '^CALENDAR_ENABLED=true'              "$base_env" && load_it=1 ;;
      files)      [[ -f "$base_env" ]] && grep -q   '^FILES_ENABLED=true'                 "$base_env" && load_it=1 ;;
      voice)      [[ -f "$base_env" ]] && grep -qE '^(ELEVENLABS_API_KEY|GROQ_API_KEY)=' "$base_env" && load_it=1 ;;
      voice-call) [[ -f "$base_env" ]] && grep -q   '^GOOGLE_API_KEY='                    "$base_env" && load_it=1 ;;
    esac

    if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
      echo "  (dry-run/unattended) $role staged; service registration skipped"
      continue
    fi
    if [[ "$load_it" != "1" ]]; then
      echo "  $role not enabled in $base_env -- staged but not started"
      continue
    fi

    local entry="$target_dir/pbox-${role}.mjs"
    [[ "$role" == "conductor" ]] && entry="$target_dir/pbox-conductor.mjs"
    [[ -f "$entry" ]] || entry="$(ls "$target_dir"/pbox-*.mjs 2>/dev/null | head -1)"
    [[ -n "$entry" && -f "$entry" ]] || { echo "  SKIP $role: no runtime .mjs in $target_dir"; continue; }
    local logf="/tmp/${LOG_PREFIX:-pandoras-box}-${slug}-${role}.log"

    if [[ "${PBOX_OS:-$(uname -s)}" == "Darwin" ]]; then
      # macOS: render + load the LaunchDaemon plist template.
      local rendered="/tmp/pbox-${slug}-${role}-plist.$$"
      sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
          -e "s|{{SLUG}}|${slug}|g" \
          -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
          -e "s|{{NODE_BIN}}|${node_bin}|g" \
          -e "s|{{LOG_PREFIX}}|${LOG_PREFIX:-pandoras-box}|g" \
          -e "s|{{USER_NAME}}|${user}|g" \
          "$plist_src" > "$rendered"
      plutil -lint "$rendered" >/dev/null \
        || { rm -f "$rendered"; echo "  FAIL: rendered plist invalid for $role"; continue; }
      sudo cp "$rendered" "$plist_dst"
      sudo chown root:wheel "$plist_dst" 2>/dev/null || true
      sudo chmod 644 "$plist_dst"
      rm -f "$rendered"
      sudo launchctl unload "$plist_dst" 2>/dev/null || true
      sudo launchctl load "$plist_dst" 2>/dev/null \
        || echo "  WARN: launchctl load failed for $plist_label"
      echo "  LaunchDaemon loaded: $plist_label"
    else
      # Linux: register a systemd unit via the os-compat helper (pbox-<slug>-<role>).
      # Passes the per-tenant env the runtime reads at boot. EnvironmentFile picks
      # up the rest of <slug>/.env. This is the path the macOS-only code skipped.
      if declare -f pbox_create_service >/dev/null 2>&1; then
        pbox_create_service "$plist_label" "$node_bin" "$entry" "$user" "$logf" "$target_dir" "$base_env" \
          || { echo "  WARN: systemd service registration failed for $plist_label"; continue; }
        # The conductor reads COMPANY_SLUG/INSTALL_PATH/PREFIX from env; ensure they
        # are present in the unit even if absent from <slug>/.env.
        local unit="pbox-${plist_label##*.}"
        sudo mkdir -p "/etc/systemd/system/${unit}.service.d"
        printf '[Service]\nEnvironment=COMPANY_SLUG=%s\nEnvironment=INSTALL_PATH=%s\nEnvironment=LAUNCHDAEMON_PREFIX=%s\n' \
          "$slug" "$INSTALL_PATH" "$LAUNCHDAEMON_PREFIX" \
          | sudo tee "/etc/systemd/system/${unit}.service.d/10-tenant-env.conf" >/dev/null
        sudo systemctl daemon-reload
        sudo systemctl restart "${unit}.service" 2>/dev/null || true
        echo "  systemd service started: ${unit}"
      else
        echo "  WARN: pbox_create_service unavailable (os-compat.sh not sourced); $role staged but not started"
      fi
    fi
  done

  echo "[setup-tenant-runtimes] done for $slug"
}
