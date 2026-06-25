# calendar

> **Calendar Sync**
>
> **Status:** Available now with Microsoft 365. Google Calendar is a preview (not yet functional).
> **Depends on:** `mail-ms365` (functional) or `mail-google` (preview) — provides the OAuth tokens this module reuses

> This installer writes `CALENDAR_ENABLED=true` into your company `.env` so the conductor spawns the calendar agent. The conductor + calendar agent ship and run in this release.

## What It Does

Enables the Calendar Agent for a company to read and write calendar events. Uses the same authentication as the mail module (no additional login required).

Microsoft Outlook Calendar (via the MS365 OAuth tokens) is supported today. Google Calendar is a preview: no Google MCP server ships yet, so it is not yet functional.

## Requirements

| Requirement | Value |
|-------------|-------|
| `mail-ms365` OR `mail-google` | One of these must be installed first |
| Microsoft Graph permission | `Calendars.ReadWrite` (Application, with admin consent) — for Outlook |
| Google OAuth scope | `https://www.googleapis.com/auth/calendar` — for Google Calendar |
| Node.js | 18+ (checked by install.sh) |

## Monthly Cost

No additional cost beyond your existing Microsoft 365 or Google Workspace subscription.

## How to Install

```
sudo bash modules/calendar/install.sh
```

You will be prompted for:
- Company slug (must match an installed company)
- Confirmation that the API permission has been granted

## After Installation

The installer writes `CALENDAR_ENABLED=true` to `$INSTALL_PATH/<company-slug>/.env`. When the conductor restarts, it picks up the flag and spawns the calendar task agent under the company's service account.

Test (Microsoft 365): ask your company agent *"What meetings do I have this week?"*

## Uninstall

```
sudo bash modules/calendar/uninstall.sh
```

Or manually: remove the `CALENDAR_ENABLED=true` line from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- The calendar agent reads + writes events but cannot delete shared calendars. Mutations on personal calendars are allowed; mutations on group / room calendars require operator approval at runtime.
- Token refresh is handled by the mail module's daily refresh LaunchAgent; this module piggybacks on that.
- Cross-tenant isolation: per-tenant service-account UID + per-tenant token cache mean Company A's agent cannot read Company B's calendar.
