#!/usr/bin/env bash
# install.sh -- calendar module installer
set -euo pipefail

MODULE_NAME="calendar"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Detecting mail module in use"
read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG
BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ -f "$BASE_ENV" ]] || { echo "FAIL: $BASE_ENV not found."; exit 1; }

if grep -q "^MS365_CLIENT_ID=" "$BASE_ENV"; then
  MAIL_TYPE="ms365"
  ok "Detected: Microsoft 365"
elif grep -q "^GOOGLE_CLIENT_ID=" "$BASE_ENV"; then
  MAIL_TYPE="google"
  ok "Detected: Google Workspace"
else
  echo "FAIL: No mail module configured for $COMPANY_SLUG."
  echo "  Install mail-ms365 or mail-google first."
  exit 1
fi

step 2 "Verifying calendar API permissions"
if [[ "$MAIL_TYPE" == "ms365" ]]; then
  echo "  For Microsoft 365 calendar, ensure your Azure app has:"
  echo "  Calendars.ReadWrite (Application permission) with admin consent."
  echo "  If not yet added, add it now and re-run: modules/mail-ms365/install.sh"
else
  echo "  For Google Calendar, ensure your OAuth credentials include:"
  echo "  https://www.googleapis.com/auth/calendar"
fi
read -rp "  Permissions confirmed? (yes/no) [yes]: " confirmed
confirmed="${confirmed:-yes}"
[[ "$confirmed" =~ ^[Yy] ]] || { echo "FAIL: Add the permissions and re-run."; exit 1; }

step 3 "Enabling calendar agent and restarting conductor"
sudo sed -i'' '/^CALENDAR_ENABLED=/d' "$BASE_ENV"
sudo bash -c "echo 'CALENDAR_ENABLED=true' >> '$BASE_ENV'"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
ok "Calendar agent enabled for $COMPANY_SLUG"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Calendar access enabled for '$COMPANY_SLUG'."
echo "  Test: ask your company agent 'What meetings do I have this week?'"
