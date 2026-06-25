#!/usr/bin/env bash
# install.sh -- relay-discord module installer
# ROADMAP: the Discord relay driver is not implemented in this release. This
# wires Discord bot credentials into the company .env for when the driver
# ships, but the conductor will not connect to Discord yet. The default relay
# is the built-in browser/localhost-HTTP relay.
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

echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │  ROADMAP: $MODULE_NAME is NOT available in this release."
echo "  │"
echo "  │  This saves your Discord credentials, but the Discord relay driver"
echo "  │  is not implemented yet, so no Discord relay runs. The default is"
echo "  │  the built-in browser/localhost relay."
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""

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
  ok "Conductor restarted. The Discord driver is not implemented yet, so no Discord relay runs."
else
  ok "Credentials saved for a future Discord driver. Use the built-in browser/localhost relay today."
fi

step 4 "Verify"
echo "  Not available yet: the Discord relay is roadmap."
echo "  Use the default built-in browser/localhost relay today."

echo ""
echo "[$MODULE_NAME] PASS (roadmap -- credentials saved)"
echo "  Discord credentials saved for '$COMPANY_SLUG' (channel $DISCORD_CHANNEL_ID)."
echo "  The Discord relay is not functional in this release."
