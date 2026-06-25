# relay-slack

> **Slack Relay**
>
> **Status:** Roadmap · Not yet available. The Slack relay driver is not implemented in this release; the default conductor relay is the built-in browser/localhost-HTTP relay.
> **Depends on:** `core` (mutually exclusive with `relay-discord` / `relay-whatsapp` per company — one relay per tenant)

> ⚠️  **ROADMAP -- not yet available.** This installer writes `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` + `RELAY_TYPE=slack` into your company `.env`, but the Slack socket-mode driver that would consume them is not implemented yet, so saving the credentials does not enable a Slack relay. Use the default built-in browser/localhost relay today. See CHANGELOG for release status.

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

The installer writes `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `RELAY_TYPE=slack` to `$INSTALL_PATH/<company-slug>/.env`. These are stored for when the Slack driver ships. The Slack relay driver is not implemented in this release, so the conductor will not connect to Slack even after the credentials are saved.

Test: not available yet -- the Slack relay is roadmap. Use the default built-in browser/localhost relay today.

## Uninstall

```
sudo bash modules/relay-slack/uninstall.sh
```

Or manually: remove `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and the `RELAY_TYPE=slack` line from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- Only ONE relay per company is supported by the conductor. Installing relay-discord or relay-whatsapp on the same company overwrites RELAY_TYPE.
- Socket Mode does NOT require your Mac to be publicly reachable — Slack connects outbound from your conductor.
- Per-tenant isolation: each company's conductor uses its own bot token. Company A's bot cannot read Company B's Slack workspace.
