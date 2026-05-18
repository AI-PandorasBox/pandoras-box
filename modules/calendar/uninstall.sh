#!/usr/bin/env bash
# uninstall.sh -- calendar module uninstaller
# Removes CALENDAR_ENABLED=true from the company .env and restarts the
# conductor. Safe to run if the install never completed.
set -euo pipefail

MODULE_NAME="calendar"

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

read -rp "  Company slug to remove calendar from: " COMPANY_SLUG
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

sudo sed -i'' '/^CALENDAR_ENABLED=/d' "$BASE_ENV"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true

echo "[$MODULE_NAME] Removed CALENDAR_ENABLED from $BASE_ENV. Conductor restarted."
