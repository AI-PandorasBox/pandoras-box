#!/usr/bin/env bash
# uninstall.sh -- relay-whatsapp module uninstaller
# Removes env keys + optionally the per-tenant bridge dir (which contains
# the WhatsApp Web session state).
set -euo pipefail

MODULE_NAME="relay-whatsapp"

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

read -rp "  Company slug to remove WhatsApp relay from: " COMPANY_SLUG
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

sudo sed -i'' '/^WHATSAPP_BRIDGE_DIR=/d' "$BASE_ENV"
sudo sed -i'' '/^RELAY_TYPE=whatsapp/d' "$BASE_ENV"

BRIDGE_DIR="$INSTALL_PATH/$COMPANY_SLUG/whatsapp-bridge"
if [[ -d "$BRIDGE_DIR" ]]; then
  read -rp "  Also delete the bridge dir $BRIDGE_DIR (clears session state)? (yes/no) [no]: " del
  if [[ "$del" =~ ^[Yy] ]]; then
    sudo rm -rf "$BRIDGE_DIR"
    echo "  Bridge dir deleted. Remember to unlink the device in the WhatsApp app on the phone."
  fi
fi

sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true

echo "[$MODULE_NAME] Removed WhatsApp relay config from $BASE_ENV. Conductor restarted."
