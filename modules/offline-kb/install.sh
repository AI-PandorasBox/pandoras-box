#!/usr/bin/env bash
# install.sh -- offline-kb module installer
# Local Kiwix server (Docker) + branded search wrapper (Node LaunchDaemon).
set -euo pipefail

MODULE_NAME="offline-kb"
TOTAL_STEPS=7

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

DRY_RUN_ACTIVE="${PBOX_DRY_RUN_ACTIVE:-${PBOX_DRY_RUN:-0}}"

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/$MODULE_NAME"
ZIM_DIR="$TARGET_DIR/zim"
STORE_DIR="$TARGET_DIR/store"
RUNTIME_SCRIPT="pbox-offline-kb.mjs"
PLIST_LABEL="${LAUNCHDAEMON_PREFIX}.offline-kb"
PLIST_DIR="${PBOX_PLIST_DIR:-/Library/LaunchDaemons}"
PLIST_PATH="${PLIST_DIR}/${PLIST_LABEL}.plist"

OFFLINE_KB_PORT="${OFFLINE_KB_PORT:-8090}"
OFFLINE_KB_BIND="${OFFLINE_KB_BIND:-127.0.0.1}"
KIWIX_INTERNAL_PORT="${KIWIX_INTERNAL_PORT:-8089}"

# ZIM catalogue. URL paths are relative to https://download.kiwix.org/zim/.
ZIM_BASE_URL="https://download.kiwix.org/zim"
declare -a ZIM_KEYS=(
  "wikipedia_en_simple_all_nopic"
  "wikipedia_en_all_nopic"
  "wikipedia_en_all"
  "wiktionary_en_all_nopic"
  "stackoverflow.com_en_all"
  "skip"
)
zim_path_for() {
  case "$1" in
    wikipedia_en_simple_all_nopic) echo "wikipedia/wikipedia_en_simple_all_nopic.zim" ;;
    wikipedia_en_all_nopic)         echo "wikipedia/wikipedia_en_all_nopic.zim" ;;
    wikipedia_en_all)               echo "wikipedia/wikipedia_en_all.zim" ;;
    wiktionary_en_all_nopic)        echo "wiktionary/wiktionary_en_all_nopic.zim" ;;
    stackoverflow.com_en_all)       echo "stack_exchange/stackoverflow.com_en_all.zim" ;;
    *) echo "" ;;
  esac
}
zim_size_for() {
  case "$1" in
    wikipedia_en_simple_all_nopic) echo "~1.5 GB" ;;
    wikipedia_en_all_nopic)         echo "~13 GB" ;;
    wikipedia_en_all)               echo "~95 GB" ;;
    wiktionary_en_all_nopic)        echo "~1 GB" ;;
    stackoverflow.com_en_all)       echo "~80 GB" ;;
    skip)                           echo "no download" ;;
    *) echo "" ;;
  esac
}

# ----------------------------------------------------------------------------
step 1 "Prerequisites"
command -v node &>/dev/null || fail "Node.js not on PATH (brew install node)"
NODE_BIN=$(command -v node)
ok "Node.js found at $NODE_BIN"

if ! command -v docker &>/dev/null; then
  echo "  Docker not found on PATH."
  if [[ "$PBOX_OS" == Darwin ]]; then
    echo "  Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    echo "  Or via Homebrew:        brew install --cask docker"
  else
    echo "  Install via apt:        sudo apt install -y docker.io"
    echo "  Or follow the upstream guide for your distro: https://docs.docker.com/engine/install/"
  fi
  fail "Docker is required for the Kiwix container"
fi
ok "Docker found at $(command -v docker)"

[[ -d "$MODULE_SRC_DIR" ]] || fail "Runtime dir missing at $MODULE_SRC_DIR"

# ----------------------------------------------------------------------------
step 2 "Selecting ZIM pack"
DEFAULT_KEY="wikipedia_en_simple_all_nopic"
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ZIM_KEY="$DEFAULT_KEY"
  ok "Dry-run: defaulting to $ZIM_KEY (no download)"
else
  echo "  Available ZIM packs:"
  i=1
  for k in "${ZIM_KEYS[@]}"; do
    marker=" "
    [[ "$k" == "$DEFAULT_KEY" ]] && marker="*"
    printf "    [%d]%s %-32s %s\n" "$i" "$marker" "$k" "$(zim_size_for "$k")"
    i=$((i+1))
  done
  echo "    (* = default, press Enter to accept)"
  read -rp "  Choose 1-${#ZIM_KEYS[@]}: " CHOICE
  if [[ -z "$CHOICE" ]]; then
    ZIM_KEY="$DEFAULT_KEY"
  else
    [[ "$CHOICE" =~ ^[0-9]+$ ]] || fail "Selection must be a number"
    (( CHOICE >= 1 && CHOICE <= ${#ZIM_KEYS[@]} )) || fail "Selection out of range"
    ZIM_KEY="${ZIM_KEYS[$((CHOICE-1))]}"
  fi
  ok "Selected: $ZIM_KEY ($(zim_size_for "$ZIM_KEY"))"
fi

# ----------------------------------------------------------------------------
step 3 "Downloading ZIM"
sudo mkdir -p "$ZIM_DIR" "$STORE_DIR"
sudo chown -R "$(pbox_stat_owner "$INSTALL_PATH")" "$TARGET_DIR"

if [[ "$ZIM_KEY" == "skip" ]]; then
  ok "Skipped per operator choice (drop your own .zim into $ZIM_DIR)"
elif [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ok "Dry-run: would download $ZIM_KEY from $ZIM_BASE_URL (skipped)"
else
  ZIM_REL_PATH="$(zim_path_for "$ZIM_KEY")"
  ZIM_URL="$ZIM_BASE_URL/$ZIM_REL_PATH"
  ZIM_FILE_NAME="$(basename "$ZIM_REL_PATH")"
  ZIM_DEST="$ZIM_DIR/$ZIM_FILE_NAME"
  if [[ -f "$ZIM_DEST" ]]; then
    ok "ZIM already present at $ZIM_DEST (skip download)"
  else
    echo "  Downloading $ZIM_URL"
    echo "  Destination: $ZIM_DEST"
    curl -L --fail --retry 3 -o "$ZIM_DEST.part" "$ZIM_URL" || fail "ZIM download failed"
    mv "$ZIM_DEST.part" "$ZIM_DEST"
    ok "Downloaded $ZIM_FILE_NAME"
  fi
  # SHA256 companion verification (best-effort; not all paths publish it).
  SHA_URL="${ZIM_URL}.sha256"
  if curl -sfL "$SHA_URL" -o "$ZIM_DEST.sha256.txt" 2>/dev/null; then
    EXPECTED=$(awk '{print $1}' "$ZIM_DEST.sha256.txt")
    ACTUAL=$(pbox_checksum_sha256 "$ZIM_DEST")
    if [[ -n "$EXPECTED" && "$EXPECTED" == "$ACTUAL" ]]; then
      ok "SHA256 verified"
    else
      fail "SHA256 mismatch (expected=$EXPECTED actual=$ACTUAL)"
    fi
  else
    echo "  WARN: No .sha256 companion found at $SHA_URL -- skipping verification"
  fi
fi

# ----------------------------------------------------------------------------
step 4 "Rendering docker-compose.yml"
COMPOSE_TMPL="$MODULE_SRC_DIR/docker-compose.yml.template"
[[ -f "$COMPOSE_TMPL" ]] || fail "compose template missing at $COMPOSE_TMPL"
COMPOSE_DEST="$TARGET_DIR/docker-compose.yml"
RENDERED_COMPOSE="/tmp/pbox-${MODULE_NAME}-compose-$$.yml"
sed -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
    -e "s|{{KIWIX_INTERNAL_PORT}}|${KIWIX_INTERNAL_PORT}|g" \
    "$COMPOSE_TMPL" > "$RENDERED_COMPOSE"
sudo cp "$RENDERED_COMPOSE" "$COMPOSE_DEST"
sudo chmod 644 "$COMPOSE_DEST"
rm -f "$RENDERED_COMPOSE"
ok "Wrote $COMPOSE_DEST"

# ----------------------------------------------------------------------------
step 5 "Starting Kiwix container"
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ok "Dry-run: would run 'docker compose up -d' in $TARGET_DIR (skipped)"
else
  ( cd "$TARGET_DIR" && docker compose up -d ) || fail "docker compose up failed"
  ok "Kiwix container started on 127.0.0.1:${KIWIX_INTERNAL_PORT}"
fi

# ----------------------------------------------------------------------------
step 6 "Staging wrapper + plist + .env"
sudo cp "$MODULE_SRC_DIR/$RUNTIME_SCRIPT" "$TARGET_DIR/"
sudo chmod 755 "$TARGET_DIR/$RUNTIME_SCRIPT"

ENV_PATH="$TARGET_DIR/.env"
if [[ -f "$ENV_PATH" ]]; then
  ok ".env preserved (delete to regenerate)"
else
  sudo bash -c "cat > '$ENV_PATH'" <<ENVEOF
OFFLINE_KB_PORT=$OFFLINE_KB_PORT
OFFLINE_KB_BIND=$OFFLINE_KB_BIND
KIWIX_HOST=127.0.0.1
KIWIX_INTERNAL_PORT=$KIWIX_INTERNAL_PORT
INSTALL_PATH=$INSTALL_PATH
SYSTEM_NAME=${SYSTEM_NAME:-Pandoras Box}
COLOR_ACCENT=${COLOR_ACCENT:-#c9a227}
COLOR_BACKGROUND=${COLOR_BACKGROUND:-#0f1115}
COLOR_TEXT=${COLOR_TEXT:-#e8e8e8}
NODE_ENV=production
ENVEOF
  sudo chmod 600 "$ENV_PATH"
  ok "Wrote $ENV_PATH"
fi

SERVICE_USER="${OFFLINE_KB_USER:-$(pbox_stat_owner "$INSTALL_PATH")}"
if [[ "$PBOX_OS" == Darwin ]]; then
  PLIST_TMPL="$MODULE_SRC_DIR/com.pandoras-box.offline-kb.plist.template"
  [[ -f "$PLIST_TMPL" ]] || fail "plist template missing at $PLIST_TMPL"
  RENDERED="/tmp/pbox-${MODULE_NAME}-plist-$$.plist"
  sed -e "s|{{LAUNCHDAEMON_PREFIX}}|${LAUNCHDAEMON_PREFIX}|g" \
      -e "s|{{INSTALL_PATH}}|${INSTALL_PATH}|g" \
      -e "s|{{NODE_BIN}}|${NODE_BIN}|g" \
      -e "s|{{LOG_PREFIX}}|${LOG_PREFIX}|g" \
      -e "s|{{USER_NAME}}|${SERVICE_USER}|g" \
      "$PLIST_TMPL" > "$RENDERED"
  plutil -lint "$RENDERED" >/dev/null || fail "rendered plist failed plutil validation"

  if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
    ok "Dry-run: rendered plist OK, not installing"
    rm -f "$RENDERED"
  else
    sudo mkdir -p "$PLIST_DIR"
    sudo cp "$RENDERED" "$PLIST_PATH"
    sudo chown root:wheel "$PLIST_PATH"
    sudo chmod 644 "$PLIST_PATH"
    rm -f "$RENDERED"
    if launchctl list | grep -q "$PLIST_LABEL" 2>/dev/null; then
      sudo launchctl unload "$PLIST_PATH" 2>/dev/null || true
    fi
    sudo launchctl load "$PLIST_PATH" 2>/dev/null || fail "launchctl load failed"
    ok "LaunchDaemon loaded: $PLIST_LABEL"
  fi
else
  if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
    ok "Dry-run: systemd unit not installed"
  else
    OKB_LOG="/tmp/${LOG_PREFIX}-offline-kb.log"
    pbox_create_service "$PLIST_LABEL" "$NODE_BIN" "$TARGET_DIR/$RUNTIME_SCRIPT" \
      "$SERVICE_USER" "$OKB_LOG" "$TARGET_DIR" "$ENV_PATH" || fail "systemd service install failed"
    ok "systemd service installed: pbox-${PLIST_LABEL##*.}"
  fi
fi

# ----------------------------------------------------------------------------
step 7 "Verifying HTTP response"
if [[ "$DRY_RUN_ACTIVE" == "1" ]]; then
  ok "Dry-run: skipping HTTP verify"
else
  sleep 2
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$OFFLINE_KB_BIND:$OFFLINE_KB_PORT/" || echo "000")
  if [[ "$HTTP" == "200" ]]; then
    ok "Wrapper responding: HTTP $HTTP"
  else
    echo "[$MODULE_NAME] WARN: Wrapper registered but HTTP $HTTP"
    echo "  Check: tail -50 /tmp/${LOG_PREFIX}-offline-kb.log"
  fi
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Wrapper UI:     http://$OFFLINE_KB_BIND:$OFFLINE_KB_PORT/"
echo "  Kiwix upstream: http://127.0.0.1:$KIWIX_INTERNAL_PORT/"
echo "  ZIM directory:  $ZIM_DIR"
exit 0
