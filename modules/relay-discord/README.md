# relay-discord

> **Discord Relay**

**Status:** Optional
**Depends on:** core

## What It Does

Connects a company conductor to Discord. Messages sent in the configured channel
are received by the conductor and replied to by the agent.

## Monthly Cost

None (Discord bot API is free).

## How to Install

```
sudo bash modules/relay-discord/install.sh
```

## Uninstall

Remove `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, and `RELAY_TYPE=discord` from the
conductor's `.env` file. Restart the conductor.
