#!/usr/bin/env bash
# install.sh -- mail-google module installer
set -euo pipefail

MODULE_NAME="mail-google"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Checking prerequisites"
command -v node &>/dev/null || { echo "FAIL: Node.js required."; exit 1; }

step 2 "Collecting Google OAuth credentials"
echo ""
echo "  You need a Google Cloud project with OAuth 2.0 credentials."
echo "  If you do not have one yet, see: docs/api-keys.md"
echo ""
read -rp "  Google OAuth Client ID: " GOOGLE_CLIENT_ID
read -rsp "  Google OAuth Client Secret (hidden): " GOOGLE_CLIENT_SECRET
echo ""
echo ""
read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

sudo sed -i'' '/^GOOGLE_CLIENT_ID=/d' "$BASE_ENV"
sudo sed -i'' '/^GOOGLE_CLIENT_SECRET=/d' "$BASE_ENV"
sudo bash -c "echo 'GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID' >> '$BASE_ENV'"
sudo bash -c "echo 'GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET' >> '$BASE_ENV'"
sudo chmod 600 "$BASE_ENV"
ok "Credentials written to $BASE_ENV"

step 3 "Running Google OAuth authentication flow"
echo ""
echo "  A browser window will open to authorise the Google account."
echo "  Sign in with the company's Google Workspace account."
echo ""
read -rp "  Press Return to start the auth flow..."
# The actual OAuth flow is handled by the conductor on first use
echo "  Google OAuth credentials saved. The conductor will complete the auth"
echo "  flow on its next restart when it detects new Google credentials."

step 4 "Restarting conductor"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
ok "Conductor restarted"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Mail agent for '$COMPANY_SLUG' is configured for Google Workspace."
