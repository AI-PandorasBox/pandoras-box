# files

> **Document Access (SharePoint / Drive)**
>
> **Status:** Optional · Scaffolded for v0.5.x (credentials wire here; agent surface ships in v0.5.x)
> **Depends on:** `mail-ms365` or `mail-google` (provides the OAuth tokens this module reuses)

> ⚠️  **SCAFFOLDED MODULE.** This installer writes `FILES_ENABLED=true` into your company `.env` so the v0.5.x conductor will spawn the files agent when it starts. The conductor runtime itself is not in v0.4 -- expect the agent surface to go live when you install v0.5.x. See CHANGELOG for release status.

## What It Does

Enables the Files Agent to access documents in SharePoint (Microsoft 365) or Google Drive. The agent can search for, read, summarise, and create documents.

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

The installer writes `FILES_ENABLED=true` to `$INSTALL_PATH/<company-slug>/.env`. When the v0.5.x conductor restarts, it picks up the flag and spawns the files task agent under the company's service account.

Test (after v0.5.x): ask your company agent *"Find the latest version of [document name]"*.

## Uninstall

```
sudo bash modules/files/uninstall.sh
```

Or manually: remove the `FILES_ENABLED=true` line from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- The files agent can search and READ files freely. WRITE / CREATE operations are operator-confirmed at runtime (the agent surfaces an approval prompt).
- DELETE operations are refused unless the operator explicitly approves with a sub-confirmation.
- Cross-tenant isolation: per-tenant service-account UID + per-tenant token cache mean Company A's agent cannot see Company B's documents.
