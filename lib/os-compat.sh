# =============================================================================
# os-compat.sh -- OS portability layer for the Pandoras Box installer.
#
# Sourced early by pbox-setup.sh. Every OS-specific operation goes through a
# pbox_* wrapper here. On macOS (Darwin) each wrapper runs exactly the command
# the installer used before this layer existed, so the macOS path is unchanged.
# On Linux the wrapper runs the systemd/apt/useradd/.desktop equivalent.
#
# Mutating wrappers self-guard on PBOX_DRY_RUN_ACTIVE: in a dry-run they log the
# intended action and return 0 without touching the system. (The existing
# setup-dry-run.sh shims macOS commands like launchctl/brew; it does NOT know
# about systemctl/apt/useradd, so the guard must live here too.)
# =============================================================================

PBOX_OS="$(uname -s)"   # Darwin | Linux
export PBOX_OS

# Log helper: reuse the dry-run shim logger if present, else a plain stderr line.
_pbox_compat_log() {
  if declare -F _pbox_log_shim >/dev/null 2>&1; then _pbox_log_shim "$*"; else echo "  [os-compat] $*" >&2; fi
}
# _UNATTENDED_IS_REAL_2026-05-30 -- only a true DRY-RUN skips mutations. Previously
# this also returned true for PBOX_UNATTENDED, so unattended installs silently skipped
# ALL service/package/user creation -> hollow installs (no argus, terminal, admin-lite,
# personal-ai service, etc). setup-unattended.sh documents unattended as a REAL install;
# this now matches that. (See proj_public-release-readiness.)
_pbox_dry() { [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; }

# Fallback UI helpers so this file is sourceable by a module install.sh that has
# NOT sourced setup-core.sh (modules run as separate `sudo bash` processes). If
# setup-core already defined them, those win.
declare -F check_pass   >/dev/null 2>&1 || check_pass()  { echo "  [PASS] $*"; }
declare -F check_fail   >/dev/null 2>&1 || check_fail()  { echo "  [FAIL] $*"; }
declare -F info_msg     >/dev/null 2>&1 || info_msg()    { echo "  $*"; }
declare -F warn_msg     >/dev/null 2>&1 || warn_msg()    { echo "  WARNING: $*"; }
declare -F success_msg  >/dev/null 2>&1 || success_msg() { echo "  $*"; }

# --- OS / version gate ------------------------------------------------------
pbox_os_check() {
  case "$PBOX_OS" in
    Darwin)
      local ver major; ver=$(sw_vers -productVersion 2>/dev/null || echo 0); major=${ver%%.*}
      if [[ "${major:-0}" -ge 14 ]]; then check_pass "macOS $ver"; else check_fail "macOS $ver (14+ required)"; return 1; fi ;;
    Linux)
      if [[ -r /etc/os-release ]]; then
        . /etc/os-release
        case "${ID:-}" in
          debian) if [[ "${VERSION_ID%%.*}" -ge 13 ]]; then check_pass "Debian ${VERSION_ID}"; else check_fail "Debian ${VERSION_ID} (13/Trixie+ required)"; return 1; fi ;;
          ubuntu) if [[ "${VERSION_ID%%.*}" -ge 24 ]]; then check_pass "Ubuntu ${VERSION_ID}"; else check_fail "Ubuntu ${VERSION_ID} (24.04+ required)"; return 1; fi ;;
          *) warn_msg "Untested distro '${ID:-?}' (Debian/Ubuntu recommended)"; check_pass "${PRETTY_NAME:-Linux}" ;;
        esac
      else check_fail "cannot read /etc/os-release"; return 1; fi ;;
    *) check_fail "Unsupported OS: $PBOX_OS"; return 1 ;;
  esac
}

# --- system package install -------------------------------------------------
# pbox_install_pkg <brew-name> [apt-name]
pbox_install_pkg() {
  local brew_name="$1" apt_name="${2:-$1}"
  case "$PBOX_OS" in
    Darwin) brew install "$brew_name" ;;
    Linux)  _pbox_dry && { _pbox_compat_log "apt-get install -y $apt_name (skipped: dry-run)"; return 0; }
            sudo apt-get install -y "$apt_name" ;;
  esac
}

# --- cross-platform stat: owner username of a path --------------------------
pbox_stat_owner() {
  case "$PBOX_OS" in
    Darwin) stat -f '%Su' "$1" ;;
    Linux)  stat -c '%U'  "$1" ;;
  esac
}

# --- checksum ---------------------------------------------------------------
pbox_checksum_sha256() {
  case "$PBOX_OS" in
    Darwin) shasum -a 256 "$1" | awk '{print $1}' ;;
    Linux)  sha256sum    "$1" | awk '{print $1}' ;;
  esac
}

# --- validate a generated service/plist file --------------------------------
# macOS: plutil -lint on the rendered plist. Linux: systemd-analyze verify on
# the rendered unit if available, else a no-op (systemctl rejects bad units).
pbox_validate_service_file() {
  local file="$1"
  case "$PBOX_OS" in
    Darwin) plutil -lint "$file" >/dev/null ;;
    Linux)  command -v systemd-analyze >/dev/null 2>&1 && systemd-analyze verify "$file" >/dev/null 2>&1 || true ;;
  esac
}

# --- create a persistent service --------------------------------------------
# pbox_create_service <label> <node_bin> <script> <user> <log> [workdir] [env_file]
#   label    e.g. com.pandoras-box.personal-ai  (Linux unit becomes pbox-personal-ai)
#   On Darwin the CALLER still renders+loads its own plist template (this wrapper
#   is only invoked on the Linux branch); kept here so callers read symmetrically.
pbox_create_service() {
  local label="$1" node_bin="$2" script="$3" user="$4" log="$5" workdir="${6:-$(dirname "$3")}" env_file="${7:-}"
  local unit="pbox-${label##*.}"
  local unit_path="/etc/systemd/system/${unit}.service"
  if _pbox_dry; then
    unit_path="${PBOX_PLIST_DIR:-/tmp}/${unit}.service"
    _pbox_compat_log "systemd unit -> $unit_path (dry-run: written, not enabled)"
  fi

  # Real-deployment hardening: daemon agents run as a dedicated per-service
  # account, never root. (Zeus/admin is the operator's own login, not a daemon,
  # so it is never provisioned here.) Caller may pass an explicit non-root user
  # to override. Group 'pbox' + 0750 lets Argus oversee peers via the shared group.
  if [[ "$user" == "root" || -z "$user" ]]; then
    user="$unit"
    if ! _pbox_dry; then
      getent group pbox >/dev/null 2>&1 || sudo groupadd pbox
      if ! id "$user" &>/dev/null; then
        sudo useradd --system --gid pbox --shell /usr/sbin/nologin \
          --home-dir "$workdir" --no-create-home \
          --comment "Pandoras Box ${label##*.}" "$user" \
          || { check_fail "could not create service user $user"; return 1; }
      fi
      if [[ -d "$workdir" ]]; then
        sudo chown -R "$user:pbox" "$workdir" 2>/dev/null || true
        sudo chmod 750 "$workdir" 2>/dev/null || true
      fi
    else
      _pbox_compat_log "would create service user '$user' + chown '$workdir' (dry-run)"
    fi
  fi

  # _WORKDIR_OWNERSHIP_2026-05-30 -- always ensure the run user owns its workdir,
  # even when the caller passed an EXISTING user (e.g. the operator login). The
  # chown above only fires when os-compat creates a per-service account; modules
  # that write state (personal-ai's memory.db) otherwise crash with
  # "unable to open database file" because the dir was created root-owned via sudo.
  if ! _pbox_dry && [[ -d "$workdir" && -n "$user" && "$user" != "root" ]]; then
    sudo chown -R "$user" "$workdir" 2>/dev/null || true
  fi

  local envline=""
  if [[ -n "$env_file" ]]; then
    envline="EnvironmentFile=-${env_file}"
    # Make the .env file group-readable so peer services (notably pbox-dashboard
    # and pbox-admin-lite) can read PORT keys to render status rows. Group is
    # 'pbox' so only members of that group can read; world stays 0.
    if [[ -f "$env_file" ]] && ! _pbox_dry; then
      sudo chown "root:pbox" "$env_file" 2>/dev/null || true
      sudo chmod 640 "$env_file" 2>/dev/null || true
    fi
  fi
  sudo tee "$unit_path" >/dev/null <<UNIT
[Unit]
Description=Pandoras Box -- ${unit}
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${workdir}
ExecStart=${node_bin} ${script}
${envline}
Restart=always
RestartSec=5
StandardOutput=append:${log}
StandardError=append:${log}
SyslogIdentifier=${unit}

[Install]
WantedBy=multi-user.target
UNIT
  sudo chmod 644 "$unit_path"
  if _pbox_dry; then _pbox_compat_log "systemctl enable --now ${unit} (skipped: dry-run)"; return 0; fi
  sudo systemctl daemon-reload
  sudo systemctl enable --now "${unit}.service"
}

pbox_service_running() {
  local label="$1"
  case "$PBOX_OS" in
    Darwin) launchctl list 2>/dev/null | grep -q "$label" ;;
    Linux)  systemctl is-active --quiet "pbox-${label##*.}" ;;
  esac
}

pbox_service_stop_start() {
  local label="$1"
  if _pbox_dry; then _pbox_compat_log "restart $label (skipped: dry-run)"; return 0; fi
  case "$PBOX_OS" in
    Darwin) sudo launchctl stop "$label" 2>/dev/null || true; sudo launchctl start "$label" 2>/dev/null || true ;;
    Linux)  sudo systemctl restart "pbox-${label##*.}" ;;
  esac
}

# --- service account --------------------------------------------------------
pbox_create_service_account() {
  local username="$1" uid="$2" display_name="$3"
  if id "$username" &>/dev/null; then info_msg "Service account '$username' already exists -- skipping."; return 0; fi
  if _pbox_dry; then _pbox_compat_log "create service account $username (uid $uid) (skipped: dry-run)"; return 0; fi
  case "$PBOX_OS" in
    Darwin)
      sudo dscl . -create "/Users/$username"
      sudo dscl . -create "/Users/$username" UserShell /usr/bin/false
      sudo dscl . -create "/Users/$username" RealName "$display_name"
      sudo dscl . -create "/Users/$username" UniqueID "$uid"
      sudo dscl . -create "/Users/$username" PrimaryGroupID 20
      sudo dscl . -create "/Users/$username" NFSHomeDirectory "/opt/pandoras-box/$username" ;;
    Linux)
      sudo groupadd --gid 601 pbox 2>/dev/null || true
      sudo useradd --system --uid "$uid" --gid pbox --shell /usr/sbin/nologin \
        --home-dir "/opt/pandoras-box/$username" --no-create-home --comment "$display_name" "$username"
      sudo mkdir -p "/opt/pandoras-box/$username"
      sudo chown "$username:pbox" "/opt/pandoras-box/$username"
      sudo chmod 750 "/opt/pandoras-box/$username" ;;
  esac
  check_pass "Service account '$username' created."
}

# --- secret storage ---------------------------------------------------------
# pbox_store_secret <service-name> <value>
# Linux: file under $INSTALL_PATH/.secrets (600), the headless-safe equivalent of
# the macOS Keychain (a login keyring is not available to system services).
pbox_store_secret() {
  local service="$1" value="$2"
  if _pbox_dry; then _pbox_compat_log "store secret '$service' (skipped: dry-run)"; return 0; fi
  case "$PBOX_OS" in
    Darwin) security add-generic-password -a "$USER" -s "$service" -w "$value" -U 2>/dev/null ;;
    Linux)
      sudo mkdir -p "${INSTALL_PATH:-/opt/pandoras-box}/.secrets"
      sudo chmod 700 "${INSTALL_PATH:-/opt/pandoras-box}/.secrets"
      printf '%s' "$value" | sudo tee "${INSTALL_PATH:-/opt/pandoras-box}/.secrets/$service" >/dev/null
      sudo chmod 600 "${INSTALL_PATH:-/opt/pandoras-box}/.secrets/$service" ;;
  esac
}

pbox_retrieve_secret() {
  local service="$1"
  case "$PBOX_OS" in
    Darwin) security find-generic-password -a "$USER" -s "$service" -w 2>/dev/null ;;
    Linux)  sudo cat "${INSTALL_PATH:-/opt/pandoras-box}/.secrets/$service" 2>/dev/null ;;
  esac
}

# --- trust a CA certificate system-wide -------------------------------------
pbox_trust_ca() {
  local ca_cert="$1"
  if _pbox_dry; then _pbox_compat_log "trust CA $ca_cert (skipped: dry-run)"; return 0; fi
  case "$PBOX_OS" in
    Darwin) sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$ca_cert" ;;
    Linux)  sudo cp "$ca_cert" /usr/local/share/ca-certificates/pandoras-box-ca.crt && sudo update-ca-certificates >/dev/null ;;
  esac
}

# --- desktop launcher (.app on macOS, .desktop on Linux) --------------------
pbox_make_launcher() {
  local name="$1" url="$2" icon="${3:-applications-internet}"
  case "$PBOX_OS" in
    Darwin)
      local app="$HOME/Desktop/${name}.app"
      [[ -d "$app" ]] && { info_msg "$name.app already exists."; return 0; }
      osacompile -o "$app" -e "on run
  tell application \"System Events\" to open location \"${url}\"
end run" 2>/dev/null || return 1 ;;
    Linux)
      local apps="$HOME/.local/share/applications" desk="$HOME/Desktop"
      mkdir -p "$apps" "$desk"
      # Filename: lowercase, spaces -> '-', collapse repeated '-', strip trailing '-'.
      local slug; slug=$(echo "$name" | tr '[:upper:] ' '[:lower:]-' | tr -s '-' | sed 's/-*$//')
      local f="$apps/pbox-${slug}.desktop"
      # Three-way browser fallback so a minimal GNOME / X11 install without a
      # configured default still launches: xdg-open -> gio open -> x-www-browser.
      cat > "$f" <<DESK
[Desktop Entry]
Version=1.0
Type=Application
Name=${name}
Comment=Open ${name}
Exec=sh -c 'xdg-open "${url}" || gio open "${url}" || x-www-browser "${url}"'
Icon=${icon}
Terminal=false
StartupNotify=true
Categories=Network;WebBrowser;
DESK
      chmod +x "$f"
      # Refresh the application database so the launcher appears in Activities
      # / app drawer immediately. Best-effort.
      command -v update-desktop-database &>/dev/null \
        && update-desktop-database "$apps" 2>/dev/null || true
      # Drop a copy in ~/Desktop too -- only renders if the user has a
      # desktop-icons extension installed (GNOME 43+ ships WITHOUT one by
      # default). Mark it trusted so it launches without the right-click dance
      # when the extension is present.
      if cp "$f" "$desk/" 2>/dev/null; then
        chmod +x "$desk/$(basename "$f")" 2>/dev/null || true
        command -v gio &>/dev/null \
          && gio set "$desk/$(basename "$f")" metadata::trusted true 2>/dev/null || true
      fi ;;
  esac
  check_pass "Created launcher: $name"
}

# --- user-session notification ----------------------------------------------
pbox_notify() {
  local title="$1" msg="$2"
  case "$PBOX_OS" in
    Darwin) osascript -e "display notification \"${msg}\" with title \"${title}\"" 2>/dev/null || true ;;
    Linux)  command -v notify-send >/dev/null 2>&1 && notify-send "$title" "$msg" || true ;;
  esac
}

# --- play an audio test file ------------------------------------------------
pbox_play_audio() {
  local file="$1"
  case "$PBOX_OS" in
    Darwin) afplay "$file" 2>/dev/null || true ;;
    Linux)
      if command -v mpg123 >/dev/null 2>&1; then mpg123 -q "$file" 2>/dev/null || true
      elif command -v ffplay >/dev/null 2>&1; then ffplay -nodisp -autoexit "$file" 2>/dev/null || true
      else info_msg "No audio player found; saved at $file"; fi ;;
  esac
}

# --- distribute Claude subscription creds to a service account --------------
# Lets a daemon agent's service user authenticate the `claude` CLI bridge (no API
# key). Copies the operator's ~/.claude credentials into the service user's home.
# Linux only; no-op on macOS (single-user) and when no operator creds exist.
# pbox_distribute_claude_creds <service_user> <service_home>
pbox_distribute_claude_creds() {
  local svc_user="$1" svc_home="$2"
  [[ "$PBOX_OS" == Darwin ]] && return 0
  if _pbox_dry; then _pbox_compat_log "would distribute Claude creds to $svc_user (dry-run)"; return 0; fi
  local op_user op_home
  op_user="${SUDO_USER:-$USER}"
  op_home="$(getent passwd "$op_user" 2>/dev/null | cut -d: -f6)"
  [[ -z "$op_home" ]] && op_home="$HOME"
  local src="$op_home/.claude"
  if [[ ! -f "$src/.credentials.json" ]]; then
    info_msg "No subscription credentials at $src/.credentials.json -- CLI bridge not provisioned (API-key mode?)."
    return 0
  fi
  sudo install -d -m 700 "$svc_home/.claude"
  sudo cp "$src/.credentials.json" "$svc_home/.claude/.credentials.json"
  [[ -f "$src/settings.json" ]] && sudo cp "$src/settings.json" "$svc_home/.claude/settings.json" 2>/dev/null || true
  sudo chown -R "$svc_user:pbox" "$svc_home/.claude" 2>/dev/null || sudo chown -R "$svc_user" "$svc_home/.claude"
  sudo chmod 700 "$svc_home/.claude"
  sudo chmod 600 "$svc_home/.claude/.credentials.json"
  check_pass "Claude subscription credentials provisioned for $svc_user (CLI bridge)."
}
