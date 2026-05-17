#!/usr/bin/env bash
# install.sh -- mail-ms365 module installer
set -euo pipefail

MODULE_NAME="mail-ms365"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Checking prerequisites"
command -v node &>/dev/null || { echo "FAIL: Node.js required. Run: brew install node"; exit 1; }

step 2 "Collecting Microsoft 365 credentials"
echo ""
echo "  You need an Azure app registration with Microsoft Graph permissions."
echo "  If you do not have one yet, see: docs/api-keys.md"
echo ""
read -rp "  Application (client) ID: " MS365_CLIENT_ID
read -rp "  Directory (tenant) ID: " MS365_TENANT_ID
read -rsp "  Client secret (hidden): " MS365_CLIENT_SECRET
echo ""

step 3 "Writing credentials to company base .env"
echo ""
echo "  Which company slug should receive these credentials?"
ls "$INSTALL_PATH"/ | grep -v -E '(argus|muse|scripts|certs|theme|service-provider)' | \
  grep -v '\-conductor\|-mail\|-calendar\|-files\|-voice' | head -20
echo ""
read -rp "  Company slug (e.g. company-a): " COMPANY_SLUG

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
if [[ ! -f "$BASE_ENV" ]]; then
  echo "  FAIL: $BASE_ENV not found. Check the company slug."
  exit 1
fi

sudo sed -i'' '/^MS365_CLIENT_ID=/d' "$BASE_ENV"
sudo sed -i'' '/^MS365_TENANT_ID=/d' "$BASE_ENV"
sudo sed -i'' '/^MS365_CLIENT_SECRET=/d' "$BASE_ENV"
sudo bash -c "echo 'MS365_CLIENT_ID=$MS365_CLIENT_ID' >> '$BASE_ENV'"
sudo bash -c "echo 'MS365_TENANT_ID=$MS365_TENANT_ID' >> '$BASE_ENV'"
sudo bash -c "echo 'MS365_CLIENT_SECRET=$MS365_CLIENT_SECRET' >> '$BASE_ENV'"
sudo chmod 600 "$BASE_ENV"
ok "Credentials written to $BASE_ENV"

step 4 "Running Microsoft 365 authentication flow"
echo ""
echo "  About to open the Microsoft 365 login flow."
echo "  A browser window will open. Sign in with the company's Microsoft 365 account."
echo "  After signing in, return here and press Ctrl+C."
echo ""
read -rp "  Press Return to start the auth flow..."

TOKEN_CACHE="$INSTALL_PATH/$COMPANY_SLUG/store/ms365-auth"
sudo mkdir -p "$TOKEN_CACHE"
sudo chmod 775 "$TOKEN_CACHE"

MS365_MCP_TOKEN_CACHE_PATH="$TOKEN_CACHE/.token-cache.json" \
  node "$INSTALL_PATH/$COMPANY_SLUG/node_modules/@softeria/ms-365-mcp-server/dist/index.js" \
  --login --org-mode || true

ok "Auth flow completed. Token cache: $TOKEN_CACHE/.token-cache.json"

step 5 "Restarting conductor to pick up new credentials"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
ok "Conductor restarted"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Mail agent for '$COMPANY_SLUG' is configured for Microsoft 365."
echo "  Test: ask your company agent 'What emails arrived today?'"
