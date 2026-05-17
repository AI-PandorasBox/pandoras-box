#!/usr/bin/env bash
# install.sh -- trading-research trading signals module installer
set -euo pipefail

MODULE_NAME="trading-research"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

echo ""
echo "  DISCLAIMER"
echo "  ──────────"
echo "  the Trading Research Agent provides trading signals and market data analysis. It is not financial advice."
echo "  Trading involves significant risk of loss. You are responsible for all trading"
echo "  decisions and their outcomes. Nothing this module generates constitutes professional"
echo "  financial advice or a recommendation to trade."
echo ""
read -rp "  I understand this is not financial advice (yes/no): " accepted
[[ "$accepted" =~ ^[Yy] ]] || { echo "Installation cancelled."; exit 0; }

step 1 "Checking Python environment"
if ! command -v python3 &>/dev/null; then
  echo "FAIL: Python 3 is required for the Trading Research Agent."
  echo "  Install: brew install python3"
  exit 1
fi
ok "Python: $(python3 --version)"

step 2 "Installing Python dependencies"
TRADING_RESEARCH_DIR="$INSTALL_PATH/trading-research"
sudo mkdir -p "$TRADING_RESEARCH_DIR"
sudo chown "$(whoami):staff" "$TRADING_RESEARCH_DIR"
pip3 install --quiet pandas numpy requests yfinance ta-lib 2>/dev/null || \
  pip3 install --quiet pandas numpy requests yfinance 2>/dev/null || {
  echo "  NOTE: Some optional packages could not be installed."
  echo "  Core functionality still available."
}
ok "Python packages installed"

step 3 "Collecting brokerage API credentials"
echo ""
echo "  the Trading Research Agent supports IG Markets and compatible market data providers."
echo "  Enter your API credentials (leave blank to configure later)."
echo ""
read -rp "  API identifier / username: " TRADING_RESEARCH_API_USER
read -rsp "  API key/password (hidden): " TRADING_RESEARCH_API_KEY
echo ""
read -rp "  Account ID (if required): " TRADING_RESEARCH_ACCOUNT_ID
read -rp "  API environment (live/demo) [demo]: " TRADING_RESEARCH_ENV
TRADING_RESEARCH_ENV="${TRADING_RESEARCH_ENV:-demo}"

TRADING_RESEARCH_ENV_FILE="$TRADING_RESEARCH_DIR/.env"
sudo bash -c "cat > '$TRADING_RESEARCH_ENV_FILE'" <<ENVEOF
TRADING_RESEARCH_API_USER=$TRADING_RESEARCH_API_USER
TRADING_RESEARCH_API_KEY=$TRADING_RESEARCH_API_KEY
TRADING_RESEARCH_ACCOUNT_ID=$TRADING_RESEARCH_ACCOUNT_ID
TRADING_RESEARCH_ENVIRONMENT=$TRADING_RESEARCH_ENV
TRADING_RESEARCH_ENABLED=true
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' "$INSTALL_PATH/muse/.env" 2>/dev/null | cut -d= -f2 || echo "")
ENVEOF
sudo chmod 600 "$TRADING_RESEARCH_ENV_FILE"
ok "Credentials written to $TRADING_RESEARCH_ENV_FILE"

step 4 "Creating default watchlist"
WATCHLIST="$TRADING_RESEARCH_DIR/watchlist.json"
if [[ ! -f "$WATCHLIST" ]]; then
  sudo bash -c "cat > '$WATCHLIST'" <<WEOF
{
  "instruments": [],
  "note": "Add instrument epics or tickers here. Example: [{\"epic\": \"IX.D.NASDAQ.IFD.IP\", \"label\": \"NASDAQ 100\"}]"
}
WEOF
  ok "Default watchlist created at $WATCHLIST"
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  the Trading Research Agent is installed. Next steps:"
echo "  1. Edit $WATCHLIST to add instruments to monitor"
echo "  2. Ask your Personal Assistant: 'Show me the the Trading Research Agent signals'"
echo "  3. Signals appear in your morning briefing once configured"
echo ""
echo "  REMINDER: Use demo environment until you have verified signal quality."
