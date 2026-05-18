# mail-google

> **Gmail Integration**
>
> **Status:** Optional · Scaffolded for v0.5.x (credentials wire here; agent surface ships in v0.5.x)
> **Depends on:** `core` (this module is an alternative to `mail-ms365` for the same per-tenant mail agent)

> ⚠️  **SCAFFOLDED MODULE.** This installer writes `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` into your company `.env`. The OAuth flow itself runs when the v0.5.x conductor first needs to read mail. The conductor runtime is not in v0.4 -- the agent surface goes live when you install v0.5.x. See CHANGELOG for release status.

## What It Does

Connects the Mail Agent for a company to Gmail via the Google OAuth API. Enables the agent to read, search, and send email using a Google Workspace or Gmail account.

## Requirements

| Requirement | Value |
|-------------|-------|
| Google Cloud project | Required, with Gmail API enabled (plus Calendar / Drive APIs if those modules are also installed) |
| OAuth 2.0 Desktop credentials | `client_id` + `client_secret` from the project's Credentials page |
| OAuth consent screen | "Internal" if the account is in a Google Workspace org. "External" works but tokens expire after 7 days unless the project is published. |
| Node.js | 18+ (checked by install.sh) |

Required OAuth scopes (the conductor requests these on first auth):

| Scope | Purpose |
|-------|---------|
| `https://www.googleapis.com/auth/gmail.modify` | Read and manage email |
| `https://www.googleapis.com/auth/gmail.send` | Send email |
| `https://www.googleapis.com/auth/calendar` | Required if `calendar` module also installed |
| `https://www.googleapis.com/auth/drive` | Required if `files` module also installed |

Full setup walkthrough: see `docs/setup/google-ai.md`.

## Monthly Cost

No additional cost beyond your existing Google Workspace subscription.

## How to Install

```
sudo bash modules/mail-google/install.sh
```

You will be prompted for:
- Google OAuth Client ID (visible)
- Google OAuth Client Secret (hidden)
- Company slug (must match an installed company)

## After Installation

The installer writes `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to `$INSTALL_PATH/<company-slug>/.env`. When the v0.5.x conductor starts and first needs to read mail for this company, it opens a browser to complete the OAuth flow. Tokens are cached at `$INSTALL_PATH/<company-slug>/store/google-auth/`.

Test (after v0.5.x): ask your company agent *"What emails arrived today?"*

## Uninstall

```
sudo bash modules/mail-google/uninstall.sh
```

Or manually: remove the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` lines from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor. Optionally delete the cached tokens at `$INSTALL_PATH/<company-slug>/store/google-auth/`.

## Notes

- Use a separate Google Cloud project per company tenant. Sharing one project across tenants means a single OAuth client knows about multiple tenants — undesirable for isolation.
- Token refresh is handled automatically by the conductor (every refresh-cycle the refresh_token is exchanged for a fresh access_token).
- If you change OAuth scopes later, the operator must re-authorise (existing tokens won't have the new scope).
