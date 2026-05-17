#!/usr/bin/env bash
# install.sh -- files module installer
set -euo pipefail

MODULE_NAME="files"
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
  ok "Detected: Microsoft 365 (SharePoint)"
elif grep -q "^GOOGLE_CLIENT_ID=" "$BASE_ENV"; then
  ok "Detected: Google Workspace (Google Drive)"
else
  echo "FAIL: No mail module found for $COMPANY_SLUG. Install mail-ms365 or mail-google first."
  exit 1
fi

step 2 "Verifying files API permissions"
echo "  For SharePoint: ensure your Azure app has Files.ReadWrite.All (admin consent)."
echo "  For Google Drive: ensure your OAuth credentials include the drive scope."
read -rp "  Permissions confirmed? (yes/no) [yes]: " confirmed
confirmed="${confirmed:-yes}"
[[ "$confirmed" =~ ^[Yy] ]] || { echo "FAIL: Add permissions and re-run."; exit 1; }

step 3 "Enabling files agent"
sudo sed -i'' '/^FILES_ENABLED=/d' "$BASE_ENV"
sudo bash -c "echo 'FILES_ENABLED=true' >> '$BASE_ENV'"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
ok "Files agent enabled for $COMPANY_SLUG"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Test: ask your company agent 'Find the latest version of [document name]'"
