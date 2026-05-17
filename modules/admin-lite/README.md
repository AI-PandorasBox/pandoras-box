# admin-lite

> **Mobile Admin Panel**

**Status:** Optional
**Depends on:** core, Tailscale

## What It Does

A mobile-friendly Admin Panel accessible via Tailscale from any device. PIN-protected.
Check service status, view logs, restart services, and send commands from your phone.

## Monthly Cost

None.

## How to Access

`https://[your-tailscale-address]:8787`

Must have Tailscale running on your device.

## Security

- PIN lockout: 5 failed attempts triggers a 15-minute lockout
- Tailscale-only: not accessible from the public internet
- TLS encrypted

## Uninstall

```
sudo launchctl stop com.pandoras-box.admin-lite
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.admin-lite.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.admin-lite.plist
```
