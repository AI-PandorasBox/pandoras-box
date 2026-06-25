# files

> **Document Access (SharePoint / Drive)**
>
> **Status:** Available now with Microsoft 365 (SharePoint). Google Drive is a preview (not yet functional).
> **Depends on:** `mail-ms365` (functional) or `mail-google` (preview) — provides the OAuth tokens this module reuses

> This installer writes `FILES_ENABLED=true` into your company `.env` so the conductor spawns the files agent. The conductor + files agent ship and run in this release.

## What It Does

Enables the Files Agent to access documents in SharePoint (Microsoft 365). The agent can search for, read, summarise, and create documents. Google Drive is a preview: no Google MCP server ships yet, so it is not yet functional.

## Requirements

| Requirement | Value |
|-------------|-------|
| `mail-ms365` OR `mail-google` | One of these must be installed first |
| Microsoft Graph permission | `Files.ReadWrite.All` (Application, with admin consent) — for SharePoint |
| Google OAuth scope | `https://www.googleapis.com/auth/drive` — for Google Drive |
| Node.js | 18+ (checked by install.sh) |

## Monthly Cost

No additional cost beyond your existing Microsoft 365 or Google Workspace subscription.

## How to Install

```
sudo bash modules/files/install.sh
```

You will be prompted for:
- Company slug (must match an installed company)
- Confirmation that the API permission has been granted

## After Installation

The installer writes `FILES_ENABLED=true` to `$INSTALL_PATH/<company-slug>/.env`. When the conductor restarts, it picks up the flag and spawns the files task agent under the company's service account.

Test (Microsoft 365): ask your company agent *"Find the latest version of [document name]"*.

## Uninstall

```
sudo bash modules/files/uninstall.sh
```

Or manually: remove the `FILES_ENABLED=true` line from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- The files agent can search and READ files freely. WRITE / CREATE operations are operator-confirmed at runtime (the agent surfaces an approval prompt).
- DELETE operations are refused unless the operator explicitly approves with a sub-confirmation.
- Cross-tenant isolation: per-tenant service-account UID + per-tenant token cache mean Company A's agent cannot see Company B's documents.
