#!/usr/bin/env bash
# install.sh -- relay-slack module installer
set -euo pipefail

MODULE_NAME="relay-slack"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Collecting Slack credentials"
echo ""
echo "  To create a Slack app:"
echo "  1. Go to: https://api.slack.com/apps -> Create New App -> From scratch"
echo "  2. Name: 'Your AI System'"
echo "  3. Go to 'OAuth & Permissions' -> add Bot Token Scopes:"
echo "     chat:write, channels:history, channels:read, im:history, im:write"
echo "  4. Click 'Install to Workspace' -> copy the Bot User OAuth Token (starts with xoxb-)"
echo "  5. Go to 'Event Subscriptions' -> enable and add events:"
echo "     message.channels, message.im"
echo "     Request URL: not needed for socket mode (see below)"
echo "  6. Go to 'Socket Mode' -> Enable Socket Mode -> create an App-Level Token"
echo "     (starts with xapp-)"
echo ""
read -rsp "  Paste your Bot User OAuth Token (xoxb-..., hidden): " SLACK_BOT_TOKEN
echo ""
read -rsp "  Paste your App-Level Token (xapp-..., hidden): " SLACK_APP_TOKEN
echo ""
read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG

step 2 "Writing relay config"
RELAY_ENV="$INSTALL_PATH/${COMPANY_SLUG}-conductor/.env"
[[ -f "$RELAY_ENV" ]] || RELAY_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
sudo sed -i'' '/^SLACK_BOT_TOKEN=/d' "$RELAY_ENV"
sudo sed -i'' '/^SLACK_APP_TOKEN=/d' "$RELAY_ENV"
sudo bash -c "echo 'SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN' >> '$RELAY_ENV'"
sudo bash -c "echo 'SLACK_APP_TOKEN=$SLACK_APP_TOKEN' >> '$RELAY_ENV'"
sudo bash -c "echo 'RELAY_TYPE=slack' >> '$RELAY_ENV'" 2>/dev/null || true
sudo chmod 600 "$RELAY_ENV"
ok "Slack credentials written"

step 3 "Restarting conductor"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
ok "Conductor restarted"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Slack relay active for '$COMPANY_SLUG'."
echo "  Direct message the bot in Slack to test."
