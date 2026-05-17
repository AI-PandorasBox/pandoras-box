# mail-ms365

> **Microsoft Email Integration**
>
> **Status:** Optional · Scaffolded for v0.5.x (credentials wire here; agent surface ships in v0.5.x)
> **Depends on:** `core` (this module is an alternative to `mail-google` for the same per-tenant mail agent)

> ⚠️  **SCAFFOLDED MODULE.** This installer writes `MS365_CLIENT_ID` + `MS365_TENANT_ID` + `MS365_CLIENT_SECRET` into your company `.env`. The OAuth flow itself runs when the v0.5.x conductor first needs to read mail. The conductor runtime is not in v0.4 -- the agent surface goes live when you install v0.5.x. See CHANGELOG for release status.

## What It Does

Connects the Mail Agent for a company to Microsoft 365 (Outlook / Exchange) via the Microsoft Graph API. Enables the agent to read, search, and send email.

## Requirements

| Requirement | Value |
|-------------|-------|
| Azure app registration | Per-company. Application (client) ID + Directory (tenant) ID + a client secret |
| Microsoft Graph permissions (Application) | `Mail.ReadWrite`, `Mail.Send`; plus `Calendars.ReadWrite` (if `calendar` installed), `Files.ReadWrite.All` (if `files` installed) |
| Admin consent | Granted on the Azure app's API permissions page after permissions added |
| Client secret expiry | Recommend 24 months. Copy the Value immediately (shown once only). |
| Node.js | 18+ (checked by install.sh) |

Full walkthrough: `modules/mail-ms365/requirements.md`.

## Monthly Cost

No additional API cost beyond your existing Microsoft 365 subscription.

## How to Install

```
sudo bash modules/mail-ms365/install.sh
```

You will be prompted for:
- Application (client) ID
- Directory (tenant) ID
- Client secret (hidden)
- Company slug (must match an installed company)

## After Installation

The installer writes the three MS365 env keys to `$INSTALL_PATH/<company-slug>/.env` and pre-creates the token-cache dir at `$INSTALL_PATH/<company-slug>/store/ms365-auth/`. When the v0.5.x conductor restarts and first needs to read mail for this company, it runs the OAuth flow via `@softeria/ms-365-mcp-server` (a dependency the v0.5.x conductor ships with its `package.json`).

Token refresh is handled daily by the v0.5.x conductor.

Test (after v0.5.x): ask your company agent *"What emails arrived today?"*

## Uninstall

```
sudo bash modules/mail-ms365/uninstall.sh
```

Or manually: remove the `MS365_*` lines from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor. Optionally delete the cached tokens at `$INSTALL_PATH/<company-slug>/store/ms365-auth/`.

## Notes

- Use a separate Azure app registration per company tenant. Sharing one app across tenants means a single client_id knows about multiple tenants — undesirable for isolation.
- Token cache is owned by the per-tenant service account; only that account and the local admin group can read it.
- If authentication expires (typically every 24 months when the client secret rotates), re-run this installer with a fresh secret.
- If you change Graph permissions later, the admin must re-grant consent.
