# desktop-launchers

**Status:** Optional
**Depends on:** core (and any of the services you want a launcher for)
**Default at install:** Yes

## What It Does

Creates clickable `.app` shortcuts on your Desktop. Three by default:

- **Pandoras Box -- Dashboard.app** -- opens the system status dashboard
- **Pandoras Box -- Terminal.app** -- opens the browser-based admin terminal
- **Pandoras Box -- Assistant.app** -- opens your Personal Assistant

Each launcher is an AppleScript-built `.app` that opens the right URL in your
default browser. No more remembering ports.

## Why this exists

Pandoras Box runs three independent local web services on different ports
(8181, 8282, 8800). Without launchers, you have to remember the URLs and the
fact that they require Tailscale + the trusted CA cert.

The launchers paper over this -- you click an icon and the right browser
window opens. macOS may ask once whether you trust the app (you click Open).

## Requirements

- macOS 14+ (the launchers use osacompile which is built-in)
- The CA certificate must be trusted on this Mac (Step "Security
  certificates" in the installer) -- otherwise the URLs throw a TLS warning
- Tailscale must be running on this Mac

## Monthly Cost

Free.

## Configuration

The launchers are static -- they hardcode the hostname + port at install
time. To change them:

1. Right-click the launcher on Desktop -> Show Package Contents
2. Open `Contents/Resources/Scripts/main.scpt`
3. Edit the `open location ...` line

Or just re-run `setup-desktop-launcher.sh` after changing your Tailscale
hostname.

## Uninstall

Drag the `.app` files from your Desktop to the Trash. They are not
LaunchDaemons or LaunchAgents -- there's nothing else to remove.
