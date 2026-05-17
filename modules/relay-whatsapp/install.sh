#!/usr/bin/env bash
# install.sh -- relay-whatsapp module installer
set -euo pipefail

MODULE_NAME="relay-whatsapp"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

echo ""
echo "  IMPORTANT NOTICE"
echo "  ────────────────"
echo "  The WhatsApp relay uses an unofficial bridge (whatsapp-web.js or similar)."
echo "  Using unofficial automation tools with WhatsApp may violate WhatsApp's Terms"
echo "  of Service. Your account may be restricted or banned."
echo ""
echo "  Review WhatsApp's Terms of Service before proceeding:"
echo "  https://www.whatsapp.com/legal/terms-of-service"
echo ""
read -rp "  I have read the Terms of Service and accept the risk (yes/no): " accepted
[[ "$accepted" =~ ^[Yy] ]] || { echo "Installation cancelled."; exit 0; }
echo ""

step 1 "Checking Node.js version"
NODE_VER=$(node --version | tr -d 'v' | cut -d. -f1)
[[ "$NODE_VER" -ge 18 ]] || { echo "FAIL: Node.js 18+ required."; exit 1; }
ok "Node.js v$(node --version)"

step 2 "Installing whatsapp-web.js bridge"
BRIDGE_DIR="$INSTALL_PATH/whatsapp-bridge"
sudo mkdir -p "$BRIDGE_DIR"
sudo chown "$(whoami):staff" "$BRIDGE_DIR"
cd "$BRIDGE_DIR"
if [[ ! -f package.json ]]; then
  npm init -y >/dev/null 2>&1
  npm install whatsapp-web.js qrcode-terminal >/dev/null 2>&1 || {
    echo "FAIL: Could not install whatsapp-web.js."
    echo "  Check your internet connection and try again."
    exit 1
  }
fi
ok "Bridge installed in $BRIDGE_DIR"

step 3 "Configuring conductor"
read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG
RELAY_ENV="$INSTALL_PATH/${COMPANY_SLUG}-conductor/.env"
[[ -f "$RELAY_ENV" ]] || RELAY_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
sudo sed -i'' '/^WHATSAPP_BRIDGE_DIR=/d' "$RELAY_ENV"
sudo bash -c "echo 'WHATSAPP_BRIDGE_DIR=$BRIDGE_DIR' >> '$RELAY_ENV'"
sudo bash -c "echo 'RELAY_TYPE=whatsapp' >> '$RELAY_ENV'" 2>/dev/null || true
sudo chmod 600 "$RELAY_ENV"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true

echo ""
echo "[$MODULE_NAME] PASS"
echo "  On first run, scan the QR code in the conductor log to authenticate:"
echo "  tail -f /tmp/${LOG_PREFIX}-${COMPANY_SLUG}-conductor.log"
echo ""
echo "  WARNING: Keep your account within WhatsApp's usage policies."
