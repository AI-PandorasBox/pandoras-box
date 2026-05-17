# mail-google

> **Gmail Integration**

**Status:** Optional
**Depends on:** core

## What It Does

Connects the Mail Agent for a company to Gmail via the Google OAuth API. Enables the
agent to read, search, and send email using a Google Workspace or Gmail account.

## Requirements

- Google Cloud project with Gmail API enabled
- OAuth 2.0 Desktop credentials (client ID and secret)

See `requirements.md` for full details.

## Monthly Cost

No additional cost beyond your existing Google Workspace subscription.

## How to Install

```
sudo bash modules/mail-google/install.sh
```

## Uninstall

Remove the Google credentials from the company's `.env` file and restart the conductor.
