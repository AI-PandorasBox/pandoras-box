# calendar

> **Calendar Sync**

**Status:** Optional
**Depends on:** mail-ms365 or mail-google

## What It Does

Enables the Calendar Agent for a company to read and write calendar events.
Uses the same authentication as the mail module (no additional login required).

Supports Microsoft Outlook Calendar and Google Calendar.

## Monthly Cost

No additional cost.

## How to Install

```
sudo bash modules/calendar/install.sh
```

## After Installation

Test: "What meetings do I have this week for [company]?"

## Uninstall

Remove `CALENDAR_ENABLED=true` from the company's `.env` file and restart the conductor.
