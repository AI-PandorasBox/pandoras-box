#!/usr/bin/env bash
# install.sh -- mail-google module installer
# Wires Google OAuth credentials into the company .env. The v0.5.x conductor
# runtime spawns the mail task agent and runs the actual OAuth flow on first
# start. v0.4 ships this as a SCAFFOLDED module -- credentials get saved,
# but the agent surface goes live when v0.5.x is installed.
set -euo pipefail

MODULE_NAME="mail-google"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)/lib
[[ -f "$INSTALL_PATH/lib/stub-helpers.sh" ]] && source "$INSTALL_PATH/lib/stub-helpers.sh" \
  || source "$LIB_DIR/stub-helpers.sh"

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

stub_scaffolded_warning "$MODULE_NAME"

step 1 "Checking prerequisites"
stub_check_node || fail "Node.js prerequisite missing"

step 2 "Collecting Google OAuth credentials"
echo ""
echo "  You need a Google Cloud project with OAuth 2.0 credentials."
echo "  If you do not have one yet, see: docs/setup/google-ai.md"
echo ""
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  GOOGLE_CLIENT_ID="dryrun-placeholder"
  GOOGLE_CLIENT_SECRET="dryrun-placeholder"
  COMPANY_SLUG="dryrun-placeholder"
  ok "(dry-run) using placeholder credentials"
else
  read -rp "  Google OAuth Client ID: " GOOGLE_CLIENT_ID
  read -rsp "  Google OAuth Client Secret (hidden): " GOOGLE_CLIENT_SECRET
  echo ""
  read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG
  stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"
fi

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || -f "$BASE_ENV" ]] || fail "$BASE_ENV not found."

step 3 "Writing credentials to $BASE_ENV"
stub_env_set "$BASE_ENV" "GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID"
stub_env_set "$BASE_ENV" "GOOGLE_CLIENT_SECRET" "$GOOGLE_CLIENT_SECRET"
ok "Credentials saved (chmod 600)"

step 4 "Restarting conductor (if installed) -- OAuth flow runs on first start"
if stub_check_conductor "$COMPANY_SLUG"; then
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor"
  ok "Conductor restarted. It will open a browser to authorise Google on first need."
else
  ok "Credentials saved. Conductor not yet installed (v0.5.x). OAuth flow runs after v0.5.x ships."
fi

stub_scaffolded_warning "$MODULE_NAME"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Mail agent for '$COMPANY_SLUG' is configured for Google Workspace."
echo "  After v0.5.x: ask your company agent 'What emails arrived today?'"
