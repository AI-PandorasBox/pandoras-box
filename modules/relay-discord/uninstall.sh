#!/usr/bin/env bash
# uninstall.sh -- relay-discord module uninstaller
set -euo pipefail

MODULE_NAME="relay-discord"

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

read -rp "  Company slug to remove Discord relay from: " COMPANY_SLUG
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

sudo sed -i'' '/^DISCORD_TOKEN=/d' "$BASE_ENV"
sudo sed -i'' '/^DISCORD_CHANNEL_ID=/d' "$BASE_ENV"
sudo sed -i'' '/^RELAY_TYPE=discord/d' "$BASE_ENV"

sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true

echo "[$MODULE_NAME] Removed Discord relay config from $BASE_ENV. Conductor restarted."
