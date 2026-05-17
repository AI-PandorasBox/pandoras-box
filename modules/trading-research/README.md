# trading-research

**Status:** Optional. **NOT FINANCIAL ADVICE. INSTALLS DEMO-ONLY BY DEFAULT.**
**Depends on:** core, personal-ai

## Risk acknowledgement

This module places real orders if (and only if) you switch to production
credentials. Trading involves the risk of significant loss. The drawdown
circuit breaker is a safety mechanism but is NOT a guarantee. Past performance
does not predict future results. The author of this software is not a
financial advisor and this software does not provide financial advice.

The installer will not proceed past the the Trading Research Agent module without you typing
`I understand` (exactly, case-sensitive). The production switch is a
SEPARATE script (`trading-research-go-live.sh`) that requires at least 14 days of demo
trading and a second risk acknowledgement.

## What It Does

Generates trading signals across multiple strategies, optionally executes
through a brokerage account, and surfaces decisions in your Personal
Assistant's Reports tab.

### Strategies

| Code | Name | When it runs |
|---|---|---|
| A | Momentum | Continuous |
| B | Mean reversion | Continuous |
| C | Multi-signal (overhauled) | Continuous |
| D | Quality filter | Continuous |
| G | UK dividend run-up | Pre-ex-div windows |
| H | Index ORB (opening range breakout) | UK market open, 14:30 UK |

### Daily cycle

```
02:00 UK -- Nightly tuning: backtest current params + sanity-fail
            retrospective + the Personal AI generates parameter proposals + apply
            in-envelope changes + log out-of-envelope for your approval
07:00    -- Pre-market warmup: cache backtest results for the dashboard
09:00 / 13:00 / 17:00 / 21:00 UK -- News watch (pre-trade gate consults this)
14:30 UK -- Market open; Strategy H starts opening-range tracking
22:30 UK -- Market close; cost model runs over today's fills
```

### Drawdown circuit breaker

| Threshold | Action |
|---|---|
| -3% intraday | Block all new entries for 1 hour |
| -5% week-to-date | Block all new entries; require your acknowledgement to resume |
| -10% month-to-date | Hard halt; assistant pings you immediately |

### Autonomy envelope

Your assistant can autonomously adjust strategy parameters within an envelope
(stop-loss bounds, take-profit bounds, position size cap, sector
concentration cap). Outside the envelope, changes need your approval. You
configure the envelope during install or in the Reports tab.

## Requirements

- An IG account (demo + production) -- IG is the supported broker. Sign up
  for the demo at https://labs.ig.com (free).
- 14+ days of demo trading before the production switch.
- A pool size you choose (demo: paper money; production: real money).

## Costs

| Item | Cost |
|---|---|
| Brokerage demo account | Free |
| Brokerage production | Spread + commission per trade (varies by broker) |
| Market data (default) | Free (yfinance) |
| Market data (paid) | Optional, $10-50/month if you opt in |
| Pool size | YOUR choice. Real money on the production switch. |

**No profit guarantee. You can lose money.** The drawdown circuit caps
weekly/monthly losses but does not eliminate them, and is not a substitute
for understanding what the strategies do.

## Production switch

After 14+ days of demo trading and reviewing the decision journal:

```bash
sudo bash /opt/pandoras-box/scripts/trading-research-go-live.sh
```

This prompts for production IG credentials and requires a second risk
acknowledgement. Demo trading continues to run alongside production by default
(useful for parameter changes -- they're tested in demo before being applied
live).

## UI surface (Personal Assistant)

| Panel | What |
|---|---|
| Watchlist | Per-name array with prices, news flags, regime gate state |
| Decision journal | Every parameter change: who decided, expected vs actual outcome |
| 30-day verification | Dashboard of expected vs actual for the last 30 days |
| Strategy G / H sub-tabs | Per-strategy detail (pre-ex-div names, ORB state, fills) |
| Parameter Proposals | Out-of-envelope proposals awaiting your approval |

## Configuration

`/opt/pandoras-box/trading-research/.env` -- broker creds, pool size, drawdown thresholds,
autonomy envelope, strategy selection, market data source.

## Uninstall

```bash
launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.trading-research.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.trading-research.plist
sudo rm -rf /opt/pandoras-box/trading-research
```

This stops the Trading Research Agent. Open positions on your broker are NOT closed automatically.
Close them manually before uninstall if you want a clean exit.
