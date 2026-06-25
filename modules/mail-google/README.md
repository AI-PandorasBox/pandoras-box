# mail-google

> **Gmail Integration**
>
> **Status:** PREVIEW · Not yet functional. Microsoft 365 (`mail-ms365`) is the supported mail provider today.
> **Depends on:** `core` (this module is the Gmail alternative to `mail-ms365` for the same per-tenant mail agent)

> ⚠️  **PREVIEW -- Gmail is not functional in this release.** This installer writes `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` into your company `.env`, but no Gmail MCP server ships yet: the mail agent expects `mcp__gmail__*` tools that are not provided in this release. Saving the credentials does not make the agent able to read Gmail. For working mail today, use `mail-ms365` (Microsoft 365). Gmail support is planned for a future version.

## What It Does

When complete, this module will connect the Mail Agent for a company to Gmail via the Google OAuth API so the agent can read, search, and send email using a Google Workspace or Gmail account. The Gmail MCP server that backs this is not yet shipped, so the module is a preview only. Use `mail-ms365` for working mail today.

## Requirements

| Requirement | Value |
|-------------|-------|
| Google Cloud project | Required, with Gmail API enabled (plus Calendar / Drive APIs if those modules are also installed) |
| OAuth 2.0 Desktop credentials | `client_id` + `client_secret` from the project's Credentials page |
| OAuth consent screen | "Internal" if the account is in a Google Workspace org. "External" works but tokens expire after 7 days unless the project is published. |
| Node.js | 18+ (checked by install.sh) |

Required OAuth scopes (requested once the Gmail provider is available):

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

The installer writes `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to `$INSTALL_PATH/<company-slug>/.env`. These credentials are stored for when the Gmail provider ships. Because no Gmail MCP server is included in this release, the mail agent cannot yet act on Gmail even after the credentials are saved.

Test: not available yet -- Gmail is a preview. For working mail today, install `mail-ms365` and ask your company agent *"What emails arrived today?"*

## Uninstall

```
sudo bash modules/mail-google/uninstall.sh
```

Or manually: remove the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` lines from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor. Optionally delete the cached tokens at `$INSTALL_PATH/<company-slug>/store/google-auth/`.

## Notes

- Use a separate Google Cloud project per company tenant. Sharing one project across tenants means a single OAuth client knows about multiple tenants — undesirable for isolation.
- Token refresh and the OAuth flow will be handled automatically once the Gmail provider ships; in this preview release no token exchange happens.
- If you change OAuth scopes later, the operator must re-authorise (existing tokens won't have the new scope).
