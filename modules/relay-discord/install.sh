#!/usr/bin/env bash
# install.sh -- relay-discord module installer
# Wires Discord bot credentials into the company .env. The v0.5.x conductor
# runtime loads the Discord driver and connects to the bot when it starts.
# v0.4 ships this as a SCAFFOLDED module -- credentials get saved, but the
# relay surface goes live when v0.5.x is installed.
set -euo pipefail

MODULE_NAME="relay-discord"
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

step 1 "Collecting Discord bot credentials"
stub_check_node || fail "Node.js prerequisite missing"
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
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  DISCORD_TOKEN="dryrun-placeholder"
  DISCORD_CHANNEL_ID="123456789012345678"
  COMPANY_SLUG="dryrun-placeholder"
  ok "(dry-run) using placeholder credentials"
else
  read -rsp "  Paste your Discord bot token (hidden): " DISCORD_TOKEN
  echo ""
  read -rp "  Discord channel ID where the bot should listen: " DISCORD_CHANNEL_ID
  # Discord snowflake IDs are 18-19 digit numerics
  if ! [[ "$DISCORD_CHANNEL_ID" =~ ^[0-9]{17,20}$ ]]; then
    fail "Channel ID '$DISCORD_CHANNEL_ID' is not a valid Discord snowflake (expected 17-20 digits)."
  fi
  echo ""
  read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG
  stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"
fi

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || -f "$BASE_ENV" ]] || fail "$BASE_ENV not found."

step 2 "Writing relay config to $BASE_ENV"
stub_env_set "$BASE_ENV" "DISCORD_TOKEN" "$DISCORD_TOKEN"
stub_env_set "$BASE_ENV" "DISCORD_CHANNEL_ID" "$DISCORD_CHANNEL_ID"
stub_env_set "$BASE_ENV" "RELAY_TYPE" "discord"
ok "Discord credentials written (chmod 600)"

step 3 "Restarting conductor (if installed)"
if stub_check_conductor "$COMPANY_SLUG"; then
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor"
  ok "Conductor restarted; Discord relay active for $COMPANY_SLUG"
else
  ok "Credentials saved. Conductor not yet installed (v0.5.x). Relay goes live when v0.5.x ships."
fi

step 4 "Verify"
echo "  After v0.5.x: send a message to your Discord channel."
echo "  You should receive a reply from the bot within a few seconds."

stub_scaffolded_warning "$MODULE_NAME"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Discord relay configured for '$COMPANY_SLUG' in channel $DISCORD_CHANNEL_ID"
