# terminal

> **Browser-Based Terminal**

**Status:** Optional
**Depends on:** core

## What It Does

A browser-based terminal. Access a command line in a browser tab on your local network.
Requires a passphrase to start each session.

## How to Access

`http://[your-mac-hostname].local:8282`

## Monthly Cost

None.

## Uninstall

```
sudo launchctl stop com.pandoras-box.terminal
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.terminal.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.terminal.plist
```
