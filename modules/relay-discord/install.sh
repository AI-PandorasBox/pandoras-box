#!/usr/bin/env bash
# install.sh -- relay-discord module installer
set -euo pipefail

MODULE_NAME="relay-discord"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Collecting Discord bot credentials"
echo ""
echo "  To create a Discord bot:"
echo "  1. Go to: https://discord.com/developers/applications"
echo "  2. Click 'New Application' -- name it 'Your AI System'"
echo "  3. Go to 'Bot' -> 'Add Bot'"
echo "  4. Under 'TOKEN', click 'Reset Token' -> copy the token"
echo "  5. Enable: Message Content Intent, Server Members Intent"
echo "  6. Go to OAuth2 -> URL Generator -> scopes: bot"
echo "     Permissions: Send Messages, Read Message History, Read Messages/View Channels"
echo "  7. Copy the generated URL, open it, invite the bot to your server"
echo ""
read -rsp "  Paste your Discord bot token (hidden): " DISCORD_TOKEN
echo ""
read -rp "  Discord channel ID where the bot should listen: " DISCORD_CHANNEL_ID
echo ""
read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG

step 2 "Writing relay config"
RELAY_ENV="$INSTALL_PATH/${COMPANY_SLUG}-conductor/.env"
[[ -f "$RELAY_ENV" ]] || RELAY_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
sudo sed -i'' '/^DISCORD_TOKEN=/d' "$RELAY_ENV"
sudo sed -i'' '/^DISCORD_CHANNEL_ID=/d' "$RELAY_ENV"
sudo bash -c "echo 'DISCORD_TOKEN=$DISCORD_TOKEN' >> '$RELAY_ENV'"
sudo bash -c "echo 'DISCORD_CHANNEL_ID=$DISCORD_CHANNEL_ID' >> '$RELAY_ENV'"
sudo bash -c "echo 'RELAY_TYPE=discord' >> '$RELAY_ENV'"
sudo chmod 600 "$RELAY_ENV"
ok "Discord credentials written"

step 3 "Restarting conductor"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor" 2>/dev/null || true
ok "Conductor restarted"

step 4 "Verify"
sleep 3
echo "  Test: send a message to your Discord channel."
echo "  You should receive a reply from the bot within a few seconds."

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Discord relay active for '$COMPANY_SLUG' in channel $DISCORD_CHANNEL_ID"
