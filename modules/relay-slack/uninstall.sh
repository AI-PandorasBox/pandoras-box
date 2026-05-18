#!/usr/bin/env bash
# uninstall.sh -- relay-slack module uninstaller
set -euo pipefail

MODULE_NAME="relay-slack"

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

read -rp "  Company slug to remove Slack relay from: " COMPANY_SLUG
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

sudo sed -i'' '/^SLACK_BOT_TOKEN=/d' "$BASE_ENV"
sudo sed -i'' '/^SLACK_APP_TOKEN=/d' "$BASE_ENV"
sudo sed -i'' '/^RELAY_TYPE=slack/d' "$BASE_ENV"

sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true

echo "[$MODULE_NAME] Removed Slack relay config from $BASE_ENV. Conductor restarted."
