#!/usr/bin/env bash
# install.sh -- mail-ms365 module installer
# Wires Microsoft 365 (Azure app) credentials into the company .env. The
# v0.5.x conductor runtime runs the OAuth flow via the @softeria/ms-365-mcp
# package when it first needs to read mail. v0.4 ships this as a SCAFFOLDED
# module -- credentials get saved, but the agent surface goes live when
# v0.5.x is installed.
set -euo pipefail

MODULE_NAME="mail-ms365"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)/lib
[[ -f "$INSTALL_PATH/lib/stub-helpers.sh" ]] && source "$INSTALL_PATH/lib/stub-helpers.sh" \
  || source "$LIB_DIR/stub-helpers.sh"

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

stub_scaffolded_warning "$MODULE_NAME"

step 1 "Checking prerequisites"
stub_check_node || fail "Node.js prerequisite missing"

step 2 "Collecting Microsoft 365 credentials"
echo ""
echo "  You need an Azure app registration with Microsoft Graph permissions:"
echo "    - Mail.ReadWrite (Application, admin consent)"
echo "    - Mail.Send"
echo "    - Calendars.ReadWrite (if calendar module also installed)"
echo "    - Files.ReadWrite.All (if files module also installed)"
echo "  Full walkthrough: docs/setup/microsoft-365.md (or modules/mail-ms365/requirements.md)"
echo ""
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  MS365_CLIENT_ID="dryrun-placeholder"
  MS365_TENANT_ID="dryrun-placeholder"
  MS365_CLIENT_SECRET="dryrun-placeholder"
  COMPANY_SLUG="dryrun-placeholder"
  ok "(dry-run) using placeholder credentials"
else
  read -rp "  Application (client) ID: " MS365_CLIENT_ID
  read -rp "  Directory (tenant) ID: " MS365_TENANT_ID
  read -rsp "  Client secret (hidden): " MS365_CLIENT_SECRET
  echo ""
  read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG
  stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"
fi

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || -f "$BASE_ENV" ]] || fail "$BASE_ENV not found."

step 3 "Writing credentials to $BASE_ENV"
stub_env_set "$BASE_ENV" "MS365_CLIENT_ID" "$MS365_CLIENT_ID"
stub_env_set "$BASE_ENV" "MS365_TENANT_ID" "$MS365_TENANT_ID"
stub_env_set "$BASE_ENV" "MS365_CLIENT_SECRET" "$MS365_CLIENT_SECRET"
ok "Credentials saved (chmod 600)"

# Pre-create the token-cache dir if the company dir exists. Permissions: 750
# so the per-tenant service account can write; group read keeps admin visibility.
if [[ -d "$INSTALL_PATH/$COMPANY_SLUG" ]]; then
  TOKEN_CACHE="$INSTALL_PATH/$COMPANY_SLUG/store/ms365-auth"
  sudo mkdir -p "$TOKEN_CACHE"
  sudo chmod 750 "$TOKEN_CACHE"
  ok "Token cache dir prepared: $TOKEN_CACHE"
fi

step 4 "Restarting conductor (if installed) -- OAuth flow runs on first need"
if stub_check_conductor "$COMPANY_SLUG"; then
  # NOTE: the v0.5.x conductor runs the @softeria/ms-365-mcp-server OAuth flow
  # on first need. v0.4 stub does NOT attempt to run the flow inline because
  # the package may not be installed in the company's node_modules yet.
  sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
  sleep 1
  sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
  ok "Conductor restarted. It will run the OAuth flow on first need."
else
  ok "Credentials saved. Conductor not yet installed (v0.5.x). OAuth flow runs after v0.5.x ships."
fi

stub_scaffolded_warning "$MODULE_NAME"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Mail agent for '$COMPANY_SLUG' is configured for Microsoft 365."
echo "  After v0.5.x: ask your company agent 'What emails arrived today?'"
