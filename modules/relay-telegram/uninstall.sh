#!/usr/bin/env bash
# uninstall.sh -- remove Telegram relay config from a company .env.
set -euo pipefail
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
[[ -f "$INSTALL_PATH/theme.conf" ]] && source "$INSTALL_PATH/theme.conf"
read -rp "Company slug to remove the Telegram relay from: " SLUG
ENV="$INSTALL_PATH/$SLUG/.env"
[[ -f "$ENV" ]] || { echo "[relay-telegram] no .env at $ENV"; exit 0; }
# strip the telegram keys; leave RELAY_TYPE for the operator to reset
sudo sed -i '' '/^TELEGRAM_BOT_TOKEN=/d;/^TELEGRAM_CHAT_ID=/d' "$ENV" 2>/dev/null || \
  sudo sed -i '/^TELEGRAM_BOT_TOKEN=/d;/^TELEGRAM_CHAT_ID=/d' "$ENV"
echo "[relay-telegram] removed Telegram credentials from $ENV (RELAY_TYPE left as-is; reset it if needed)"
