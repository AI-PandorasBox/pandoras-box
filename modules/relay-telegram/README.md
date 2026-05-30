# relay-telegram

Talk to your assistant from **Telegram**. The conductor's Telegram driver
long-polls the Bot API (no inbound webhook, no public URL needed) and replies in
the same chat. You can restrict the bot to a single chat id.

## Setup

1. In Telegram, message **@BotFather** -> `/newbot` -> copy the bot token
   (looks like `123456789:AA...`).
2. Run:
   ```bash
   bash modules/relay-telegram/install.sh
   ```
   Paste the bot token, optionally the allowed chat id (recommended), and the
   company slug this relay serves.
3. Message your bot in Telegram.

To find your chat id: message the bot once, then visit
`https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`.

## Security

- **Allowed chat id** (`TELEGRAM_CHAT_ID`): if set, the bot ignores every chat
  except that one. Strongly recommended so only you can drive it.
- Long-poll only; no inbound port is opened on your Mac.
- The token is written to the company `.env` (chmod 600), never to the repo.
