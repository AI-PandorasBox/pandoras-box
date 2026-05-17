# trading-research -- Requirements

| Requirement | Value |
|-------------|-------|
| Node.js | 22+ (`brew install node`) |
| npm dependencies | None. Uses only built-in modules (`http`, `fs`, `path`, `url`, `fetch`). |
| IG demo account | Free signup at https://labs.ig.com -- username, password, demo API key. |
| Network | Outbound HTTPS to `demo-api.ig.com` only. |
| Disk | `$INSTALL_PATH/trading-research/` for runtime + `.env` + `store/watchlist.json`. |
| Ports | One TCP port on `127.0.0.1` (default `8487`, override with `TRADING_RESEARCH_PORT`). |
| Permissions | Standard user. The LaunchDaemon runs as the install path owner. |
| LIVE trading | **Not supported.** `IG_LIVE=true` causes the daemon to refuse to start. |
