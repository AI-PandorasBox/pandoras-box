# trading-research

**Status:** Optional, demo-only.
**DEMO ONLY. NOT FINANCIAL ADVICE.**
**No order placement under any circumstances.**

## What this module is

A small, dependency-free read-only research surface. It logs in to your
IG **demo** account, reads positions and account balances, and computes a
deterministic indicator (50/200 moving-average crossover on minute bars) for
a list of operator-chosen instruments. A localhost web page displays the
data. That is the entire scope.

There are no order-placement endpoints. There is no live-account support.
There is no notification surface. There is no auto-tuning. There is no
strategy engine. If you want any of those, this module is not for you.

## What this module is NOT

- Not financial advice.
- Not a backtester.
- Not a live-trading bot.
- Not a recommendation to trade anything.

This is educational software for people who want to look at their own demo
positions in a local web page and see one deterministic indicator alongside.

## Hard demo-only gate

At process start, the runtime checks `process.env.IG_LIVE`. If it equals the
exact string `"true"` it logs:

```
FATAL: IG_LIVE=true detected. This module is demo-only. Exiting.
```

and exits with code `1`. The IG REST base URL is hard-coded to
`https://demo-api.ig.com/gateway/deal/`. There is no env override.

If you want to wire the module to a live account, **the right answer is to
fork it and audit every line first.** Do not edit the gate in place.

## Prerequisites

- macOS, Node.js 22+ (`brew install node`)
- An IG demo account: free signup at `https://labs.ig.com/`. You need a demo
  username, password, and demo-account API key. **Not your live credentials.**
- No npm dependencies.

## Install

```bash
sudo bash modules/trading-research/install.sh
```

The installer:
1. Verifies Node 22+ and validates the demo-only gate is present in the runtime.
2. Stages `pbox-trading-research.mjs` + `public/` into `$INSTALL_PATH/trading-research/`.
3. Prompts for IG demo credentials (saved chmod 600 to `.env`).
4. Renders + installs the LaunchDaemon plist.
5. Curls the configured port to confirm the service responds.

Dry-run: `PBOX_DRY_RUN=1 sudo bash modules/trading-research/install.sh`
performs all validation but writes nothing and does not call `launchctl`.

## Environment variables

Written to `$INSTALL_PATH/trading-research/.env` by the installer:

| Var | Purpose |
|---|---|
| `IG_USERNAME` | IG demo login |
| `IG_PASSWORD` | IG demo login |
| `IG_API_KEY` | IG demo API key |
| `TRADING_RESEARCH_PORT` | UI port (default `8487`) |
| `INSTALL_PATH` | Resolved at install time |

Setting `IG_LIVE=true` anywhere in the environment will cause the daemon to
refuse to start.

## Watchlist

Operator-edited at `$INSTALL_PATH/trading-research/store/watchlist.json`:

```json
{
  "_comment": "List IG epics to compute 50/200 MA crossovers for. DEMO data only.",
  "epics": ["IX.D.FTSE.DAILY.IP", "CS.D.GBPUSD.MINI.IP"]
}
```

The runtime re-reads the file on every poll, so edits land without a restart.

## Signal: 50/200 moving-average crossover

For each epic, the module fetches the last 200 minute bars, computes the
50-bar and 200-bar simple moving average of the bid/ask midpoint close, and
classifies:

- `bullish_crossover` -- 50-bar MA above 200-bar MA
- `bearish_crossover` -- 50-bar MA below 200-bar MA
- `insufficient_data` -- fewer than 200 bars available
- `error` -- IG API returned an error for that epic

This is purely a deterministic indicator for display. It is **not** a trade
recommendation. Moving-average crossovers are a textbook teaching example;
their predictive value in practice ranges from "marginal" to "negative net
of cost" depending on the instrument and regime. Do not interpret
`bullish_crossover` as "buy". Do not interpret `bearish_crossover` as "sell".

## UI

`http://127.0.0.1:8487/` (localhost only). The page has a sticky top banner
in your theme accent colour:

> This is research/education software. Not financial advice. Demo account only.

Three tables: accounts, positions, signals. An SSE endpoint at
`/api/stream` pushes a fresh snapshot every 60 seconds while the page is
open. When the page is closed, polling stops and no IG calls are made.

## What it costs to run

- IG demo account: free.
- Compute: trivial.
- Anthropic API: zero. This module makes no LLM calls.

## Uninstall

```bash
sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.trading-research.plist
sudo rm /Library/LaunchDaemons/com.pandoras-box.trading-research.plist
sudo rm -rf /opt/pandoras-box/trading-research
```

There is nothing to close on the IG side -- the module never opened a
position to begin with.
