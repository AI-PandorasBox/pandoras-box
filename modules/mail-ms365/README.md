# mail-ms365

> **Microsoft Email Integration**

**Status:** Optional
**Depends on:** core

## What It Does

Connects the Mail Agent for a company to Microsoft 365 (Outlook / Exchange) via the
Microsoft Graph API. Enables the agent to read, search, and send email.

## Requirements

- Azure app registration with Mail.ReadWrite and Mail.Send permissions
- Microsoft 365 admin account to grant consent

See `requirements.md` for full details.

## Monthly Cost

No additional API cost beyond your existing Microsoft 365 subscription.

## How to Install

```
sudo bash modules/mail-ms365/install.sh
```

The installer collects your Azure credentials and runs the OAuth authentication flow.

## After Installation

- Test with: "What emails did [company] receive today?"
- Tokens are refreshed daily by the `zeus-ms365-refresh` agent
- If authentication expires, re-run this installer

## Uninstall

Remove the MS365 credentials from the company's `.env` file and restart the conductor.
The token cache at `/opt/pandoras-box/[company]/store/ms365-auth/` can also be removed.
