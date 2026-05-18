#!/usr/bin/env bash
# uninstall.sh -- mail-google module uninstaller
# Removes Google OAuth credentials from the company .env. Optionally
# removes cached tokens from the company's store dir.
set -euo pipefail

MODULE_NAME="mail-google"

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

read -rp "  Company slug to remove Google mail from: " COMPANY_SLUG
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

sudo sed -i'' '/^GOOGLE_CLIENT_ID=/d' "$BASE_ENV"
sudo sed -i'' '/^GOOGLE_CLIENT_SECRET=/d' "$BASE_ENV"

read -rp "  Also delete cached Google tokens at $INSTALL_PATH/$COMPANY_SLUG/store/google-auth/? (yes/no) [no]: " del_tokens
if [[ "$del_tokens" =~ ^[Yy] ]]; then
  sudo rm -rf "$INSTALL_PATH/$COMPANY_SLUG/store/google-auth"
  echo "  Tokens deleted."
fi

sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true

echo "[$MODULE_NAME] Removed Google OAuth credentials from $BASE_ENV. Conductor restarted."
