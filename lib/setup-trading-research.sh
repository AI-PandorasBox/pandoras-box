# _A6_1_NARRATIVE_SCRUB_V1
# =============================================================================
# setup-trading-research.sh -- the Trading Research Agent: trading signal generation + brokerage execution
# Optional. Requires brokerage account credentials. STARTS ON DEMO ONLY.
# =============================================================================

run_trading_research_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  # _A5_INSTALLER_UX_V1 -- point operator at the matching setup guide
  print_setup_guide_link "ig-trading"
  print_module_info_card \
    "the Trading Research Agent (trading signals + execution)" \
    "Generates trading signals across multiple strategies (momentum, mean reversion, breakout, dividend run-up). With execution enabled, places orders with your broker subject to a spend pool, drawdown circuit breaker, autonomous parameter envelope, and a pre-trade news gate. Includes a decision journal, sanity-fail retrospective, and a 30-day verification dashboard. NOT FINANCIAL ADVICE. INSTALLS DEMO-ONLY BY DEFAULT -- production credentials require a separate confirmed switch after at least 14 days of demo trading." \
    "An IG account (demo + production) -- IG is the supported broker. Demo creds for now (sign up free at https://labs.ig.com). Optional: a market-data API for richer intraday signals (currently uses yfinance free)." \
    "Brokerage costs: spread + commission depending on broker. Pool size you choose. Market data: free (yfinance) by default. Paid market data: \$10-50/month if you opt in. NO PROFIT GUARANTEE -- you can lose money. Drawdown circuit breaker caps losses but does not eliminate them." \
    "~10 minutes (demo only). Production switch is a SEPARATE step after at least 14 days of demo verification."

  echo ""
  echo "  ${C_BOLD}${C_RED}── RISK DISCLOSURE ──${C_RESET}"
  echo ""
  echo "  This module places real orders if you switch to production credentials."
  echo "  Trading involves risk of significant loss. The drawdown circuit breaker"
  echo "  is a safety mechanism but is NOT a guarantee. Past performance does"
  echo "  not predict future results. The author of this software is not a"
  echo "  financial advisor and this is not financial advice."
  echo ""
  echo "  Required: type 'I understand' to continue."
  read -r ack
  if [[ "$ack" != "I understand" ]]; then
    info_msg "Did not type 'I understand' -- skipping the Trading Research Agent."
    return 0
  fi

  echo ""
  prompt_yes_no "Set up the Trading Research Agent (demo mode only) now?" clio_choice "no"
  if [[ "$clio_choice" != "yes" ]]; then
    return 0
  fi

  echo ""
  echo "  ${C_BOLD}Step 1 -- IG demo credentials${C_RESET}"
  echo ""
  echo "  1. Go to https://labs.ig.com (NOT the live IG site)"
  echo "  2. Sign up for the IG Labs developer demo account"
  echo "  3. Note your demo username + password + API key"
  echo "  4. Default account ID is shown in the dashboard"
  echo ""
  press_enter_to_continue

  prompt_required "IG demo username" IG_DEMO_USERNAME
  read -rsp "  IG demo password (input hidden): " IG_DEMO_PASSWORD
  echo ""
  read -rsp "  IG demo API key (input hidden): " IG_DEMO_API_KEY
  echo ""
  prompt_required "IG demo account ID" IG_DEMO_ACCOUNT

  # Validate via IG /session endpoint
  info_msg "Testing IG demo connection..."
  local test_response
  test_response=$(curl -fsSL -o /tmp/ig-test.json -w "%{http_code}" "https://demo-api.ig.com/gateway/deal/session" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-IG-API-KEY: $IG_DEMO_API_KEY" \
    -H "Version: 2" \
    -d "{\"identifier\":\"$IG_DEMO_USERNAME\",\"password\":\"$IG_DEMO_PASSWORD\"}" 2>/dev/null)
  if [[ "$test_response" == "200" ]]; then
    check_pass "IG demo connection working."
  else
    warn_msg "IG demo session returned HTTP $test_response. Check credentials and re-run."
    cat /tmp/ig-test.json | head -3 2>/dev/null
    rm -f /tmp/ig-test.json
    return 1
  fi
  rm -f /tmp/ig-test.json

  echo ""
  echo "  ${C_BOLD}Step 2 -- Pool size and risk parameters${C_RESET}"
  echo ""
  prompt_with_default "Demo pool size (GBP -- this is paper money)" "10000" TRADING_RESEARCH_POOL_GBP
  prompt_with_default "Daily drawdown circuit (% of pool, e.g. 3 = 3%)" "3" TRADING_RESEARCH_DD_DAILY_PCT
  prompt_with_default "Weekly drawdown circuit (%)" "5" TRADING_RESEARCH_DD_WEEKLY_PCT
  prompt_with_default "Monthly hard halt (%)" "10" TRADING_RESEARCH_DD_MONTHLY_PCT

  echo ""
  echo "  ${C_BOLD}Step 3 -- Strategy selection${C_RESET}"
  echo ""
  echo "  Pick which strategies to run (space-separated, default all):"
  echo "    A  Momentum"
  echo "    B  Mean reversion"
  echo "    C  Multi-signal (Phase 3 overhaul)"
  echo "    D  Quality filter"
  echo "    E  (in redesign -- skipped by default)"
  echo "    F  (signal pipeline pending -- skipped by default)"
  echo "    G  UK div run-up"
  echo "    H  Index ORB"
  echo ""
  prompt_with_default "Strategies" "A B C D G H" TRADING_RESEARCH_STRATEGIES

  echo ""
  echo "  ${C_BOLD}Step 4 -- Autonomy envelope${C_RESET}"
  echo ""
  echo "  The Personal AI can autonomously tune strategy parameters within an envelope."
  echo "  Outside the envelope, changes need your approval. Defaults are"
  echo "  conservative; you can widen them later from the Personal Assistant."
  echo ""
  prompt_with_default "Position size cap per name (%, of pool)" "30" TRADING_RESEARCH_POS_CAP
  prompt_with_default "Sector concentration cap (%)" "50" TRADING_RESEARCH_SECTOR_CAP
  prompt_with_default "Approval ceiling -- changes >X% of current value need your sign-off" "10" TRADING_RESEARCH_APPROVAL_PCT

  export IG_DEMO_USERNAME IG_DEMO_PASSWORD IG_DEMO_API_KEY IG_DEMO_ACCOUNT
  export TRADING_RESEARCH_POOL_GBP TRADING_RESEARCH_DD_DAILY_PCT TRADING_RESEARCH_DD_WEEKLY_PCT TRADING_RESEARCH_DD_MONTHLY_PCT
  export TRADING_RESEARCH_STRATEGIES TRADING_RESEARCH_POS_CAP TRADING_RESEARCH_SECTOR_CAP TRADING_RESEARCH_APPROVAL_PCT
  export TRADING_RESEARCH_MODE="demo"

  echo ""
  success_msg "the Trading Research Agent configured (demo mode)."
  echo ""
  echo "  ${C_BOLD}When you are ready to switch to production:${C_RESET}"
  echo "    1. Run at least 14 days on demo and review the decision journal."
  echo "    2. Run: sudo bash $INSTALL_PATH/scripts/trading-research-go-live.sh"
  echo "    3. The script will prompt for production IG creds and require an"
  echo "       additional acknowledgement."
  echo ""
  echo "  ${C_BOLD}Daily nightly tuning:${C_RESET} 02:00 UK"
  echo "  ${C_BOLD}News watch:${C_RESET}        09:00, 13:00, 17:00, 21:00 UK"
  echo "  ${C_BOLD}Decision journal:${C_RESET}  Personal Assistant -> Reports tab"
  echo ""
  press_enter_to_continue
}
