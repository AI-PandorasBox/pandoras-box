#!/usr/bin/env bash
# install.sh -- relay-whatsapp module installer
# ROADMAP: the WhatsApp relay driver is not implemented in this release. This
# wires WhatsApp bridge config into the company .env + bootstraps the
# whatsapp-web.js dependency tree PER-TENANT (NOT global) for when the driver
# ships, but the conductor will not connect to the bridge yet. The default
# relay is the built-in browser/localhost-HTTP relay.
set -euo pipefail

MODULE_NAME="relay-whatsapp"
TOTAL_STEPS=3

# Pinned npm dep versions. Bump deliberately, not "latest".
WHATSAPP_WEB_VERSION="^1.27"
QRCODE_TERMINAL_VERSION="^0.12"

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)/lib
[[ -f "$INSTALL_PATH/lib/stub-helpers.sh" ]] && source "$INSTALL_PATH/lib/stub-helpers.sh" \
  || source "$LIB_DIR/stub-helpers.sh"

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │  ROADMAP: $MODULE_NAME is NOT available in this release."
echo "  │"
echo "  │  This saves your WhatsApp bridge config, but the WhatsApp relay"
echo "  │  driver is not implemented yet, so no WhatsApp relay runs. The"
echo "  │  default is the built-in browser/localhost relay."
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""

echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │  TERMS OF SERVICE WARNING"
echo "  │"
echo "  │  The WhatsApp relay uses an unofficial bridge (whatsapp-web.js)."
echo "  │  Using unofficial automation tools with WhatsApp may violate"
echo "  │  WhatsApp's Terms of Service. Your account may be restricted"
echo "  │  or BANNED."
echo "  │"
echo "  │  Do NOT use this on your primary WhatsApp number. The right"
echo "  │  pattern is a SEPARATE WhatsApp number on a SEPARATE SIM or"
echo "  │  a virtual number from a service that supports WhatsApp."
echo "  │"
echo "  │  Review: https://www.whatsapp.com/legal/terms-of-service"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  accepted="yes"
else
  read -rp "  I have read the Terms of Service and accept the risk (yes/no): " accepted
fi
[[ "$accepted" =~ ^[Yy] ]] || { echo "Installation cancelled."; exit 0; }
echo ""

step 1 "Checking prerequisites + selecting company"
stub_check_node || fail "Node.js prerequisite missing"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  COMPANY_SLUG="dryrun-placeholder"
  ok "(dry-run) using placeholder slug"
else
  read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG
  stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"
fi

step 2 "Installing whatsapp-web.js bridge per-tenant (pinned)"
# Per-tenant bridge dir, NOT global. Each company has its own session +
# linked-device record. Multi-tenant on the same Mac is supported.
BRIDGE_DIR="$INSTALL_PATH/$COMPANY_SLUG/whatsapp-bridge"
sudo mkdir -p "$BRIDGE_DIR"
SERVICE_USER="${BRIDGE_USER:-$(pbox_stat_owner "$INSTALL_PATH" 2>/dev/null || echo $USER)}"
sudo chown "$SERVICE_USER:staff" "$BRIDGE_DIR" 2>/dev/null || true

if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) skipping npm install"
else
  pushd "$BRIDGE_DIR" >/dev/null
  if [[ ! -f package.json ]]; then
    npm init -y >/dev/null 2>&1
  fi
  npm install "whatsapp-web.js@${WHATSAPP_WEB_VERSION}" "qrcode-terminal@${QRCODE_TERMINAL_VERSION}" --no-audit --no-fund >/dev/null 2>&1 \
    || fail "npm install failed for whatsapp-web.js@${WHATSAPP_WEB_VERSION} qrcode-terminal@${QRCODE_TERMINAL_VERSION}"
  popd >/dev/null
  ok "Bridge installed in $BRIDGE_DIR (whatsapp-web.js ${WHATSAPP_WEB_VERSION}, qrcode-terminal ${QRCODE_TERMINAL_VERSION})"
fi

step 3 "Writing relay config + restarting conductor (if installed)"
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || -f "$BASE_ENV" ]] || fail "$BASE_ENV not found."
stub_env_set "$BASE_ENV" "WHATSAPP_BRIDGE_DIR" "$BRIDGE_DIR"
stub_env_set "$BASE_ENV" "RELAY_TYPE" "whatsapp"

if stub_check_conductor "$COMPANY_SLUG"; then
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor"
  ok "Conductor restarted. The WhatsApp driver is not implemented yet, so no WhatsApp relay runs."
else
  ok "Config saved for a future WhatsApp driver. Use the built-in browser/localhost relay today."
fi

echo ""
echo "[$MODULE_NAME] PASS (roadmap -- config saved)"
echo "  WhatsApp bridge config saved for '$COMPANY_SLUG' (per-tenant bridge dir: $BRIDGE_DIR)."
echo "  The WhatsApp relay is not functional in this release. Once the driver ships, you will"
echo "  scan a QR code from the conductor log:"
echo "    tail -f /tmp/${LOG_PREFIX}-${COMPANY_SLUG}-conductor.log"
echo "  WARNING: Keep your WhatsApp account within WhatsApp's usage policies."
