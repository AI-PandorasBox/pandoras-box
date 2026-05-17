# relay-whatsapp

**Status:** Optional. **EXPERIMENTAL.** Uses an unofficial WhatsApp Web bridge.
**Depends on:** core, personal-ai

## Risk acknowledgement

WhatsApp does not offer an official personal-account bot API. This module uses
an unofficial bridge that emulates a WhatsApp Web session.

**WhatsApp can block accounts using such bridges at any time. WhatsApp does
this without warning.** If they block the number you used to sign in, you
lose access to that number's WhatsApp -- including any history.

**Do NOT use this on your primary WhatsApp number.** The installer prompts
you to confirm you understand this risk before proceeding. The right pattern
is a separate WhatsApp account on a separate phone number (a cheap second
SIM or a virtual number from a service that supports WhatsApp registration).

## What It Does

Relays messages from a single WhatsApp number to your Personal Assistant.
You message your AI through WhatsApp (one-to-one chat with the relay's
number), it processes and replies in the same chat. Same model as the
Discord and Slack relays -- single user, no group chat support.

## Requirements

- A separate WhatsApp number (NOT your primary). Cheap second SIM, a
  pay-as-you-go data SIM, or a virtual number from a service that supports
  WhatsApp registration.
- A phone (or burner) you can scan a QR code with on first run. After that,
  the bridge maintains the session.
- The phone running the WhatsApp account must come online occasionally
  (every ~14 days) -- WhatsApp Web sessions expire if the linked phone is
  permanently offline.

## Monthly Cost

WhatsApp itself is free. The unofficial bridge has no licence cost.

The cost is the **risk of account block** plus the **cost of a separate SIM**
(£3-10/month for a cheap UK pay-as-you-go SIM, or free if you use a virtual
number service's free tier).

## First-run QR scan

When the relay starts for the first time, it prints a QR code in the log:

```
tail -f /tmp/pbox-relay-whatsapp.log
```

Open WhatsApp on the phone using the WhatsApp number you set up for this
module. Settings -> Linked Devices -> Link a Device. Point the camera at
the QR code in the terminal. Once linked, the bridge can send and receive
messages.

If the linked-device limit is hit (4 devices per WhatsApp number), unlink
something else first.

## Configuration

`/opt/pandoras-box/relays/whatsapp.env` -- WhatsApp number, your assistant's
ID, allowlist (only your number can address the relay).

## Uninstall

```bash
launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.relay-whatsapp.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.relay-whatsapp.plist
sudo rm -rf /opt/pandoras-box/relays/whatsapp
```

You may also want to unlink the device from WhatsApp itself: Linked Devices
in the WhatsApp app on the phone -> Pandoras Box relay -> Log out.
