# relay-discord

> **Discord Relay**
>
> **Status:** Roadmap · Not yet available. The Discord relay driver is not implemented in this release; the default conductor relay is the built-in browser/localhost-HTTP relay.
> **Depends on:** `core` (mutually exclusive with `relay-slack` / `relay-whatsapp` per company — one relay per tenant)

> ⚠️  **ROADMAP -- not yet available.** This installer writes `DISCORD_TOKEN` + `DISCORD_CHANNEL_ID` + `RELAY_TYPE=discord` into your company `.env`, but the Discord driver that would consume them is not implemented yet, so saving the credentials does not enable a Discord relay. Use the default built-in browser/localhost relay today. See CHANGELOG for release status.

## What It Does

Connects a company conductor to Discord. Messages sent in the configured channel are received by the conductor and replied to by the agent. Single-channel, single-direction (only the configured channel's message stream is processed).

## Requirements

| Requirement | Value |
|-------------|-------|
| Discord Developer Portal app | Free at https://discord.com/developers/applications |
| Bot token | From the app's Bot page (Reset Token to copy) |
| Bot intents enabled | Message Content Intent, Server Members Intent |
| OAuth2 scopes for invite URL | `bot` with permissions: Send Messages, Read Message History, View Channels |
| Channel ID | A 17-20 digit Discord snowflake of the channel the bot should listen on |
| Node.js | 18+ (checked by install.sh) |

## Monthly Cost

None — Discord bot API is free.

## How to Install

```
sudo bash modules/relay-discord/install.sh
```

You will be prompted for:
- Bot token (hidden)
- Channel ID (validated as 17-20 digit numeric)
- Company slug (must match an installed company)

## After Installation

The installer writes `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, and `RELAY_TYPE=discord` to `$INSTALL_PATH/<company-slug>/.env`. These are stored for when the Discord driver ships. The Discord relay driver is not implemented in this release, so the conductor will not connect to Discord even after the credentials are saved.

Test: not available yet -- the Discord relay is roadmap. Use the default built-in browser/localhost relay today.

## Uninstall

```
sudo bash modules/relay-discord/uninstall.sh
```

Or manually: remove `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, and `RELAY_TYPE` lines from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- Only ONE relay per company is supported by the conductor (RELAY_TYPE is a single string). Installing relay-slack or relay-whatsapp on the same company overwrites RELAY_TYPE.
- The bot needs the Message Content Intent enabled in the Discord Developer Portal, OR the bot must be @-mentioned in messages it should process.
- Per-tenant isolation: each company's conductor connects to its own Discord bot. Company A's bot cannot see Company B's channel.
