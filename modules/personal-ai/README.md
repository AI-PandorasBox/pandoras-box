# personal-ai

> **Personal AI Assistant**

**Status:** Recommended
**Depends on:** core

## What It Does

Installs and configures the Personal Assistant browser interface.

The Personal Assistant is your own AI that knows your context, your preferences, and your
history. Unlike a chatbot that starts fresh every session, it maintains memory across
conversations. It can:

- Deliver a morning briefing (calendar, email, priorities)
- Help with research, writing, and creative tasks
- Manage tasks and meeting preparation
- Provide a unified view across all your companies

Accessible at `https://[your-tailscale-address]:8800` from any Tailscale device.

## Requirements

- `core` module installed
- Tailscale running (for remote access)
- TLS certificate installed (for HTTPS browser access)

## Monthly Cost

Anthropic API usage: approximately £5-20 additional per month depending on conversation volume.

## How to Access

With Tailscale running on your device:

```
https://[your-tailscale-address]:8800
```

You must install the CA certificate on the device first. See `docs/certificates.md`.

## Action Management

The Actions tab shows pending actions your personal AI has queued -- things it intends to do
on your behalf before you have approved them (sending an email, creating a calendar event, etc.).

Three tools are available:

- **list_actions** -- view all pending actions with their type, description, and queued time
- **edit_action** -- modify the parameters of a pending action before it executes
- **delete_action** -- remove a pending action entirely

Actions can also be approved or rejected directly in the tab without interacting with the AI.

## Configuration

Edit `/opt/pandoras-box/muse/.env` to change:
- `MUSE_PORT` -- default 8800
- `MUSE_HOSTNAME` -- set automatically from Tailscale

## Uninstall

```
sudo launchctl stop com.pandoras-box.muse
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.muse.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.muse.plist
```

This does not delete conversation history or memory stored in `/opt/pandoras-box/muse/store/`.
