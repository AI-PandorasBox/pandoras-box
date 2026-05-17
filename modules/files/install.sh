#!/usr/bin/env bash
# install.sh -- files module installer
# Wires FILES_ENABLED=true into the company .env. The v0.5.x conductor
# runtime reads this flag and spawns the files task agent. v0.4 ships
# this as a SCAFFOLDED module -- credentials get saved, but the agent
# surface goes live when v0.5.x is installed.
set -euo pipefail

MODULE_NAME="files"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)/lib
[[ -f "$INSTALL_PATH/lib/stub-helpers.sh" ]] && source "$INSTALL_PATH/lib/stub-helpers.sh" \
  || source "$LIB_DIR/stub-helpers.sh"

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

stub_scaffolded_warning "$MODULE_NAME"

step 1 "Detecting mail module + validating slug"
stub_check_node || fail "Node.js prerequisite missing"
read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG
stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
if grep -q "^MS365_CLIENT_ID=" "$BASE_ENV"; then
  ok "Detected: Microsoft 365 (SharePoint)"
elif grep -q "^GOOGLE_CLIENT_ID=" "$BASE_ENV"; then
  ok "Detected: Google Workspace (Google Drive)"
else
  fail "No mail module found for $COMPANY_SLUG. Install mail-ms365 or mail-google first."
fi

step 2 "Verifying files API permissions"
echo "  For SharePoint: ensure your Azure app has Files.ReadWrite.All (admin consent)."
echo "  For Google Drive: ensure your OAuth credentials include the drive scope."
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  confirmed="yes"
else
  read -rp "  Permissions confirmed? (yes/no) [yes]: " confirmed
  confirmed="${confirmed:-yes}"
fi
[[ "$confirmed" =~ ^[Yy] ]] || fail "Add permissions and re-run."

step 3 "Enabling files agent + restarting conductor (if installed)"
stub_env_set "$BASE_ENV" "FILES_ENABLED" "true"
if stub_check_conductor "$COMPANY_SLUG"; then
  sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
  sleep 1
  sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
  ok "Conductor restarted; files agent enabled for $COMPANY_SLUG"
else
  ok "Credentials saved. Conductor not yet installed (v0.5.x). Agent goes live when v0.5.x ships."
fi

stub_scaffolded_warning "$MODULE_NAME"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Files access enabled for '$COMPANY_SLUG'."
echo "  Test (after v0.5.x): ask your company agent 'Find the latest version of [document name]'"
