# relay-slack

> **Slack Relay**
>
> **Status:** Optional · Scaffolded for v0.5.x (credentials wire here; relay goes live in v0.5.x)
> **Depends on:** `core` (mutually exclusive with `relay-discord` / `relay-whatsapp` per company — one relay per tenant)

> ⚠️  **SCAFFOLDED MODULE.** This installer writes `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` + `RELAY_TYPE=slack` into your company `.env`. The Slack driver that consumes these and connects via socket mode ships with the v0.5.x conductor. See CHANGELOG for release status.

## What It Does

Connects a company conductor to Slack. Messages sent to the bot (via DM or in a channel where it is mentioned) are received and replied to by the agent.

Uses Slack Socket Mode — no public webhook URL required, no port forwarding.

## Requirements

| Requirement | Value |
|-------------|-------|
| Slack workspace | Any (free or paid Slack works) |
| Slack app | Created at https://api.slack.com/apps (Create New App → From scratch) |
| Bot Token Scopes | `chat:write`, `channels:history`, `channels:read`, `im:history`, `im:write` |
| Event Subscriptions | Enabled with events `message.channels`, `message.im` |
| Socket Mode | Enabled (no Request URL needed) |
| App-Level Token | Generated under Socket Mode (starts with `xapp-`) |
| Bot User OAuth Token | After "Install to Workspace" (starts with `xoxb-`) |
| Node.js | 18+ (checked by install.sh) |

## Monthly Cost

None — Slack Bot API is free on all Slack plans.

## How to Install

```
sudo bash modules/relay-slack/install.sh
```

You will be prompted for:
- Bot User OAuth Token (hidden, validated as `xoxb-` prefix)
- App-Level Token (hidden, validated as `xapp-` prefix)
- Company slug (must match an installed company)

## After Installation

The installer writes `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `RELAY_TYPE=slack` to `$INSTALL_PATH/<company-slug>/.env`. When the v0.5.x conductor starts, it loads the Slack driver, opens a socket-mode connection, and starts listening to DMs + channel messages where the bot is mentioned.

Test (after v0.5.x): direct-message the bot in Slack.

## Uninstall

```
sudo bash modules/relay-slack/uninstall.sh
```

Or manually: remove `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and the `RELAY_TYPE=slack` line from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- Only ONE relay per company is supported by the v0.5.x conductor. Installing relay-discord or relay-whatsapp on the same company overwrites RELAY_TYPE.
- Socket Mode does NOT require your Mac to be publicly reachable — Slack connects outbound from your conductor.
- Per-tenant isolation: each company's conductor uses its own bot token. Company A's bot cannot read Company B's Slack workspace.
