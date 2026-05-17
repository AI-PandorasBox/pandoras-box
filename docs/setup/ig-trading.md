# Setup — IG.com trading account (for the Trading Research Agent module)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

> ⚠️ DISCLAIMER — TRADING SOFTWARE WARNING
>
> The the Trading Research Agent module executes trades on financial markets via IG.com's API. By installing the Trading Research Agent you acknowledge:
>
> - This software does NOT constitute financial advice.
> - All trading carries risk of loss, including loss of capital exceeding your initial deposit on margined products.
> - The maintainers accept no liability for any financial loss, missed trade, broker outage, signal error, or any other consequence of running this software.
> - You are wholly responsible for verifying every trade the Trading Research Agent proposes before it executes.
> - The default install mode is **DEMO** (paper trading). Live trading requires explicit operator opt-in via environment variable.
> - We strongly recommend running in DEMO mode for **at least 30 days of continuous observation** before considering LIVE mode, and ideally never enabling LIVE without independent professional financial advice.
>
> If you accept these terms, continue. If you do not, do NOT install the Trading Research Agent.

## Prerequisites

- An IG.com account at https://www.ig.com — free to open; both DEMO (paper trading) and LIVE (real money) accounts available.
- A funded DEMO account (IG provisions £10,000 of paper money on signup).
- Optionally: a funded LIVE account if you intend to ever enable live trading.

## Setup steps

### 1. Open an IG account

Sign up at https://www.ig.com. UK residents get full functionality. Outside the UK, IG operates under several regional entities (IG Markets US, IG Markets AU, etc.) — the Trading Research Agent supports all of them via the API endpoint setting.

### 2. Request API access

IG.com → My Account → Settings → API → **Request access**.

API access is free but requires:
- Verifying your account identity (one-time KYC)
- Agreeing to IG's API terms of use

You'll receive an API key by email within ~24 hours.

### 3. Note your credentials

You need:
- **Username** — your IG.com login username (NOT the email)
- **Password** — your IG.com password
- **API key** — the one IG emailed you
- **Account ID** — visible in IG's web UI under My Accounts; looks like `Z12ABC` for DEMO or `X45XYZ` for LIVE

For the Trading Research Agent's default DEMO setup, capture the DEMO account ID specifically (starts with `Z`).

### 4. Store credentials in macOS Keychain

The installer prompts for these during the the Trading Research Agent module step. If you're configuring manually:

```
security add-generic-password -s IG_USERNAME -a default -w
security add-generic-password -s IG_PASSWORD -a default -w
security add-generic-password -s IG_API_KEY -a default -w
security add-generic-password -s IG_ACCOUNT_ID -a default -w
```

### 5. DEMO vs LIVE switching

the Trading Research Agent's `.env` file (`/opt/pandoras-box/trading-research/.env`) sets the active mode:

```
IG_ACCOUNT_TYPE=DEMO     # default — paper trading
IG_API_ENDPOINT=https://demo-api.ig.com/gateway/deal
```

To switch to LIVE (real money):

```
IG_ACCOUNT_TYPE=LIVE
IG_API_ENDPOINT=https://api.ig.com/gateway/deal
```

And update the Keychain entry for `IG_ACCOUNT_ID` to your LIVE account ID.

The default install ships with DEMO. Do not change to LIVE casually.

## Verifying it works

After the installer finishes the the Trading Research Agent step:

```
sudo launchctl start com.pandoras-box.trading-research
```

Then check the log:

```
tail -f /tmp/pandoras-box-trading-research.log
```

You should see:

```
[trading-research] [info] Connected to IG (DEMO endpoint)
[trading-research] [info] Account balance: £10000.00 (DEMO)
[trading-research] [info] Strategy A: monitoring 5 instruments
```

If you see "Auth failed" — check the four Keychain entries match exactly what IG.com expects.

## Strategy configuration

the Trading Research Agent ships with conservative default strategies in `/opt/pandoras-box/trading-research/strategies/`. Each strategy is a `.yaml` file defining entry rules, position sizing, and stops. You can:

- Disable individual strategies — set `enabled: false` in the YAML.
- Adjust position sizing — `risk_per_trade_pct: 0.5` is the default (0.5% of account per trade).
- Add custom instruments — extend the `instruments:` list in each strategy YAML.

## Daily review

the Trading Research Agent surfaces a daily P&L summary at https://your-mac.local:8888/ → the Trading Research Agent tab. Review every trade execution. Note any unexpected behaviour.

## Revoking access

```
security delete-generic-password -s IG_USERNAME
security delete-generic-password -s IG_PASSWORD
security delete-generic-password -s IG_API_KEY
security delete-generic-password -s IG_ACCOUNT_ID
sudo launchctl stop com.pandoras-box.trading-research
sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.trading-research.plist
```

On the IG side: revoke the API key at IG.com → Settings → API. This invalidates any cached session.

## Reminder

Trading subjects you to market risk. Run DEMO indefinitely if you have any doubt. The maintainers accept no liability for outcomes.
