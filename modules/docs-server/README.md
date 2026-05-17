# docs-server

> **Local Documentation Server**

**Status:** Optional
**Depends on:** core

## What It Does

Hosts the Pandoras Box documentation as a navigable website on your local network.
All manuals are accessible in a formatted, searchable browser interface.

## How to Access

`http://[your-mac-hostname].local:8485`

## Monthly Cost

None.

## Uninstall

```
sudo launchctl stop com.pandoras-box.docs
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.docs.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.docs.plist
```
