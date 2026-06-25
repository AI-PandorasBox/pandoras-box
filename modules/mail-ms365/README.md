# mail-ms365

> **Microsoft Email Integration**
>
> **Status:** Available now · Microsoft 365 is the supported mail provider today.
> **Depends on:** `core` (this module is an alternative to `mail-google` for the same per-tenant mail agent)

> This installer writes `MS365_CLIENT_ID` + `MS365_TENANT_ID` + `MS365_CLIENT_SECRET` into your company `.env`, then wires the per-tenant mail agent against `@softeria/ms-365-mcp-server`. The OAuth `--login` step runs at setup; once you complete sign-in, the agent can read, search, and send mail. The per-tenant conductor and mail/calendar/files agents ship and are wired by the setup process.

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

The installer writes the three MS365 env keys to `$INSTALL_PATH/<company-slug>/.env` and pre-creates the token-cache dir at `$INSTALL_PATH/<company-slug>/store/ms365-auth/`. Setup wires the per-tenant `.claude/settings.json` against `@softeria/ms-365-mcp-server` (`--preset mail,calendar,files --org-mode`) and runs the `--login` OAuth step. Complete the sign-in when prompted; tokens are cached under `store/ms365-auth/` and refreshed automatically.

Test: ask your company agent *"What emails arrived today?"*

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
