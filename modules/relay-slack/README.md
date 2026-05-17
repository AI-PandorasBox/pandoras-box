# relay-slack

> **Slack Relay**

**Status:** Optional
**Depends on:** core

## What It Does

Connects a company conductor to Slack. Messages sent to the bot (via DM or in a channel
where it is mentioned) are received and replied to by the agent.

Uses Slack Socket Mode -- no public webhook URL required.

## Monthly Cost

None (Slack Bot API is free on free and paid Slack plans).

## How to Install

```
sudo bash modules/relay-slack/install.sh
```

## Uninstall

Remove `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` from the conductor's `.env`. Restart.
