#!/usr/bin/env bash
# install.sh -- calendar module installer
# Wires CALENDAR_ENABLED=true into the company .env. The conductor reads this
# flag and spawns the calendar task agent, which ships and runs in this
# release. Microsoft 365 calendar is functional today; Google Calendar is a
# preview (no Google MCP server ships yet).
set -euo pipefail

MODULE_NAME="calendar"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)/lib
[[ -f "$INSTALL_PATH/lib/stub-helpers.sh" ]] && source "$INSTALL_PATH/lib/stub-helpers.sh" \
  || source "$LIB_DIR/stub-helpers.sh"

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

step 1 "Detecting mail module + validating slug"
stub_check_node || fail "Node.js prerequisite missing"
read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG
stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
if grep -q "^MS365_CLIENT_ID=" "$BASE_ENV"; then
  MAIL_TYPE="ms365"
  ok "Detected: Microsoft 365"
elif grep -q "^GOOGLE_CLIENT_ID=" "$BASE_ENV"; then
  MAIL_TYPE="google"
  ok "Detected: Google Workspace"
else
  fail "No mail module configured for $COMPANY_SLUG. Install mail-ms365 or mail-google first."
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
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  confirmed="yes"
else
  read -rp "  Permissions confirmed? (yes/no) [yes]: " confirmed
  confirmed="${confirmed:-yes}"
fi
[[ "$confirmed" =~ ^[Yy] ]] || fail "Add the permissions and re-run."

step 3 "Enabling calendar agent + restarting conductor (if installed)"
stub_env_set "$BASE_ENV" "CALENDAR_ENABLED" "true"
if stub_check_conductor "$COMPANY_SLUG"; then
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor"
  ok "Conductor restarted; calendar agent enabled for $COMPANY_SLUG"
else
  ok "Flag saved. Conductor not detected for this company yet; run setup to install the per-tenant runtimes."
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Calendar access enabled for '$COMPANY_SLUG'."
echo "  Test (Microsoft 365): ask your company agent 'What meetings do I have this week?'"
