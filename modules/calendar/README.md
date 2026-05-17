# calendar

> **Calendar Sync**
>
> **Status:** Optional · Scaffolded for v0.5.x (credentials wire here; agent surface ships in v0.5.x)
> **Depends on:** `mail-ms365` or `mail-google` (provides the OAuth tokens this module reuses)

> ⚠️  **SCAFFOLDED MODULE.** This installer writes `CALENDAR_ENABLED=true` into your company `.env` so the v0.5.x conductor will spawn the calendar agent when it starts. The conductor runtime itself is not in v0.4 -- expect the agent surface to go live when you install v0.5.x. See CHANGELOG for release status.

## What It Does

Enables the Calendar Agent for a company to read and write calendar events. Uses the same authentication as the mail module (no additional login required).

Supports Microsoft Outlook Calendar (via the MS365 OAuth tokens) and Google Calendar (via the Google OAuth tokens).

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

The installer writes `CALENDAR_ENABLED=true` to `$INSTALL_PATH/<company-slug>/.env`. When the v0.5.x conductor restarts, it picks up the flag and spawns the calendar task agent under the company's service account.

Test (after v0.5.x): ask your company agent *"What meetings do I have this week?"*

## Uninstall

```
sudo bash modules/calendar/uninstall.sh
```

Or manually: remove the `CALENDAR_ENABLED=true` line from `$INSTALL_PATH/<company-slug>/.env` and restart the conductor.

## Notes

- The calendar agent reads + writes events but cannot delete shared calendars. Mutations on personal calendars are allowed; mutations on group / room calendars require operator approval at runtime.
- Token refresh is handled by the mail module's daily refresh LaunchAgent; this module piggybacks on that.
- Cross-tenant isolation: per-tenant service-account UID + per-tenant token cache mean Company A's agent cannot read Company B's calendar.
