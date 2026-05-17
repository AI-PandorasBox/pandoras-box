# dashboard

> **System Monitor**

**Status:** Optional
**Depends on:** core

## What It Does

A local service status dashboard. Shows all running services, recent job activity,
and system health on your local network.

## How to Access

`http://[your-mac-hostname].local:8181`
Or: `http://[your-local-IP]:8181`

Read-only. No login required (local network only).

## Monthly Cost

None.

## Uninstall

```
sudo launchctl stop com.pandoras-box.dashboard
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.dashboard.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.dashboard.plist
```
