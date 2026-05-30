#!/usr/bin/env bash
# install.sh -- relay-slack module installer
# Wires Slack bot + app credentials into the company .env. The v0.5.x conductor
# runtime loads the Slack driver and connects via socket mode when it starts.
# v0.4 ships this as a SCAFFOLDED module -- credentials get saved, but the
# relay surface goes live when v0.5.x is installed.
set -euo pipefail

MODULE_NAME="relay-slack"
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

stub_scaffolded_warning "$MODULE_NAME"

step 1 "Collecting Slack credentials"
stub_check_node || fail "Node.js prerequisite missing"
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
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  SLACK_BOT_TOKEN="xoxb-dryrun-placeholder"
  SLACK_APP_TOKEN="xapp-dryrun-placeholder"
  COMPANY_SLUG="dryrun-placeholder"
  ok "(dry-run) using placeholder credentials"
else
  read -rsp "  Paste your Bot User OAuth Token (xoxb-..., hidden): " SLACK_BOT_TOKEN
  echo ""
  read -rsp "  Paste your App-Level Token (xapp-..., hidden): " SLACK_APP_TOKEN
  echo ""
  [[ "$SLACK_BOT_TOKEN" =~ ^xoxb- ]] || fail "Bot token must start with 'xoxb-'"
  [[ "$SLACK_APP_TOKEN" =~ ^xapp- ]] || fail "App-level token must start with 'xapp-'"
  read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG
  stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"
fi

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || -f "$BASE_ENV" ]] || fail "$BASE_ENV not found."

step 2 "Writing relay config to $BASE_ENV"
stub_env_set "$BASE_ENV" "SLACK_BOT_TOKEN" "$SLACK_BOT_TOKEN"
stub_env_set "$BASE_ENV" "SLACK_APP_TOKEN" "$SLACK_APP_TOKEN"
stub_env_set "$BASE_ENV" "RELAY_TYPE" "slack"
ok "Slack credentials written (chmod 600)"

step 3 "Restarting conductor (if installed)"
if stub_check_conductor "$COMPANY_SLUG"; then
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor"
  ok "Conductor restarted; Slack relay active for $COMPANY_SLUG"
else
  ok "Credentials saved. Conductor not yet installed (v0.5.x). Relay goes live when v0.5.x ships."
fi

stub_scaffolded_warning "$MODULE_NAME"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Slack relay configured for '$COMPANY_SLUG'."
echo "  After v0.5.x: direct-message the bot in Slack to test."
