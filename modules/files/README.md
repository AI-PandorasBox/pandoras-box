# files

> **Document Access (SharePoint / Drive)**

**Status:** Optional
**Depends on:** mail-ms365 or mail-google

## What It Does

Enables the Files Agent to access documents in SharePoint (Microsoft 365) or Google Drive.
The agent can search for, read, summarise, and create documents.

## Monthly Cost

No additional cost beyond existing subscriptions.

## How to Install

```
sudo bash modules/files/install.sh
```

## Uninstall

Remove `FILES_ENABLED=true` from the company's `.env` and restart the conductor.
