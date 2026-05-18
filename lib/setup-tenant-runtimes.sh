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

  for role in conductor mail calendar files voice; do
    local module_dir target_dir plist_label plist_src plist_dst
    if [[ "$role" == "conductor" ]]; then
      module_dir="$INSTALL_PATH/modules/conductor"
      target_dir="$INSTALL_PATH/$slug-conductor"
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

    if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
      echo "  (dry-run) skipping npm install for $role"
    else
      echo "  npm install in $target_dir (pinned per package.json)"
      (cd "$target_dir" && sudo -u "$user" npm install --omit=dev --no-audit --no-fund >/dev/null) \
        || { echo "  WARN: npm install failed for $role"; }
    fi

    # Render plist
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
    echo "  plist installed: $plist_dst"

    # Conditional load
    local load_it=0
    case "$role" in
      conductor) load_it=1 ;;
      mail)
        if [[ -f "$base_env" ]] && grep -qE '^(GOOGLE_CLIENT_ID|MS365_CLIENT_ID)=' "$base_env"; then
          load_it=1
        fi
        ;;
      calendar)
        if [[ -f "$base_env" ]] && grep -q '^CALENDAR_ENABLED=true' "$base_env"; then
          load_it=1
        fi
        ;;
      files)
        if [[ -f "$base_env" ]] && grep -q '^FILES_ENABLED=true' "$base_env"; then
          load_it=1
        fi
        ;;
      voice)
        if [[ -f "$base_env" ]] && grep -qE '^(ELEVENLABS_API_KEY|GROQ_API_KEY)=' "$base_env"; then
          load_it=1
        fi
        ;;
    esac

    if [[ "$load_it" == "1" ]]; then
      if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
        echo "  (dry-run) skipping launchctl load for $plist_label"
      else
        sudo launchctl unload "$plist_dst" 2>/dev/null || true
        sudo launchctl load "$plist_dst" 2>/dev/null \
          || echo "  WARN: launchctl load failed for $plist_label"
        echo "  LaunchDaemon loaded: $plist_label"
      fi
    else
      echo "  $role not enabled in $base_env -- plist installed but not loaded"
    fi
  done

  echo "[setup-tenant-runtimes] done for $slug"
}
