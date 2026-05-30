#!/usr/bin/env bash
# install.sh -- relay-telegram module installer.
# Wires a Telegram bot token (+ optional allowed chat id) into the company .env.
# The conductor's Telegram driver long-polls and replies when it starts.
set -euo pipefail

MODULE_NAME="relay-telegram"
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

step 1 "Collecting Telegram credentials"
stub_check_node || fail "Node.js prerequisite missing"
echo ""
echo "  Create a bot: message @BotFather in Telegram -> /newbot -> copy the token."
echo "  (Optional but recommended) your chat id locks the bot to one chat:"
echo "     message the bot once, then open https://api.telegram.org/bot<TOKEN>/getUpdates"
echo ""
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  TELEGRAM_BOT_TOKEN="123456789:DRYRUNplaceholderplaceholderplaceholder"
  TELEGRAM_CHAT_ID=""
  COMPANY_SLUG="dryrun-placeholder"
  ok "(dry-run) using placeholder credentials"
else
  read -rsp "  Paste your bot token (hidden): " TELEGRAM_BOT_TOKEN; echo ""
  [[ "$TELEGRAM_BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || fail "Token must look like 123456789:AA..."
  read -rp "  Allowed chat id (Enter to allow any chat -- not recommended): " TELEGRAM_CHAT_ID
  read -rp "  Company slug this relay serves (e.g. company-a): " COMPANY_SLUG
  stub_validate_slug "$COMPANY_SLUG" || fail "Invalid company slug"
fi

BASE_ENV="$INSTALL_PATH/$COMPANY_SLUG/.env"
[[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || -f "$BASE_ENV" ]] || fail "$BASE_ENV not found."

step 2 "Writing relay config to $BASE_ENV"
stub_env_set "$BASE_ENV" "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN"
stub_env_set "$BASE_ENV" "TELEGRAM_CHAT_ID" "$TELEGRAM_CHAT_ID"
stub_env_set "$BASE_ENV" "RELAY_TYPE" "telegram"
ok "Telegram credentials written (chmod 600)"

step 3 "Restarting conductor (if installed)"
if stub_check_conductor "$COMPANY_SLUG"; then
  pbox_service_stop_start "${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor"
  ok "Conductor restarted; Telegram relay active for $COMPANY_SLUG"
else
  ok "Credentials saved. Relay goes live when the conductor for '$COMPANY_SLUG' is installed."
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Telegram relay configured for '$COMPANY_SLUG'. Message your bot to test."
[[ -z "${TELEGRAM_CHAT_ID:-}" ]] && echo "  NOTE: no allowed chat id set -- the bot will respond to anyone who finds it."
exit 0
