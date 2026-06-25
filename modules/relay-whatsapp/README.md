# relay-whatsapp

> **WhatsApp Relay (EXPERIMENTAL, unofficial bridge)**
>
> **Status:** Roadmap · Not yet available. The WhatsApp relay driver is not implemented in this release; the default conductor relay is the built-in browser/localhost-HTTP relay.
> **Depends on:** `core` (mutually exclusive with `relay-discord` / `relay-slack` per company — one relay per tenant)

> ⚠️  **ROADMAP -- not yet available.** This installer installs the per-tenant `whatsapp-web.js` bridge and writes `WHATSAPP_BRIDGE_DIR` + `RELAY_TYPE=whatsapp` into your company `.env`, but the WhatsApp driver that would run the QR-scan login and maintain the session is not implemented yet, so saving the config does not enable a WhatsApp relay. Use the default built-in browser/localhost relay today. See CHANGELOG for release status.

## ⚠️  Risk acknowledgement

WhatsApp does not offer an official personal-account bot API. This module uses an unofficial bridge (`whatsapp-web.js`) that emulates a WhatsApp Web session.

**WhatsApp can block accounts using such bridges at any time, without warning.** If they block the number you used to sign in, you lose access to that number's WhatsApp — including any history.

**Do NOT use this on your primary WhatsApp number.** The installer prompts you to confirm you understand this risk before proceeding. The right pattern is a separate WhatsApp account on a separate phone number (a cheap second SIM, or a virtual number from a service that supports WhatsApp registration).

Review WhatsApp's Terms of Service before proceeding: https://www.whatsapp.com/legal/terms-of-service

## What It Does

Relays messages from a single WhatsApp number to your Personal Assistant. You message your AI through WhatsApp (one-to-one chat with the relay's number); it processes and replies in the same chat. Same model as the Discord and Slack relays — single user, no group chat support.

## Requirements

| Requirement | Value |
|-------------|-------|
| Separate WhatsApp number | Cheap second SIM, pay-as-you-go SIM, or virtual number that supports WhatsApp registration |
| Phone / burner for first-run QR scan | Phone with WhatsApp installed on the new number; scan once during setup |
| WhatsApp Web session liveness | The phone running the WhatsApp account must come online at least every ~14 days (Web sessions expire if the linked phone is permanently offline) |
| Node.js | 18+ (checked by install.sh) |
| npm | Used to install pinned `whatsapp-web.js@^1.27` + `qrcode-terminal@^0.12` per-tenant |

## Monthly Cost

WhatsApp itself is free. The unofficial bridge has no licence cost.

The real cost is **the risk of account block** plus **the cost of a separate SIM** (£3-10/month for a cheap UK pay-as-you-go SIM, or free if you use a virtual number service's free tier).

## How to Install

```
sudo bash modules/relay-whatsapp/install.sh
```

You will be prompted for:
- Typed acceptance of the Terms-of-Service risk
- Company slug (must match an installed company)

The installer creates a per-tenant bridge dir at `$INSTALL_PATH/<company-slug>/whatsapp-bridge/` and runs `npm install` for the pinned `whatsapp-web.js` + `qrcode-terminal` versions.

## After Installation

The installer writes:
- `WHATSAPP_BRIDGE_DIR=$INSTALL_PATH/<company-slug>/whatsapp-bridge`
- `RELAY_TYPE=whatsapp`

to `$INSTALL_PATH/<company-slug>/.env`. These are stored for when the WhatsApp driver ships. The WhatsApp relay driver is not implemented in this release, so the conductor will not spawn the bridge or print a QR code even after the config is saved.

To complete the linked-device pairing (once the WhatsApp driver ships):

```
tail -f /tmp/<log-prefix>-<company-slug>-conductor.log
```

On the phone running the relay's WhatsApp number: **Settings → Linked Devices → Link a Device** → scan the QR code. Once linked, the bridge sends and receives messages.

If the linked-device limit is hit (4 devices per WhatsApp number), unlink something else first.

## Uninstall

```
sudo bash modules/relay-whatsapp/uninstall.sh
```

Or manually:
- Remove `WHATSAPP_BRIDGE_DIR` and `RELAY_TYPE=whatsapp` lines from `$INSTALL_PATH/<company-slug>/.env`
- Optionally delete `$INSTALL_PATH/<company-slug>/whatsapp-bridge/` (this also clears the session)
- Restart the conductor

You should also unlink the device from WhatsApp itself: Linked Devices in the WhatsApp app on the phone → find the bridge entry → Log out.

## Notes

- Per-tenant bridge dir (NEW in v0.4): multi-tenant deployment on the same Mac is supported. Each company has its own session + linked-device record.
- npm deps are pinned (`whatsapp-web.js@^1.27`, `qrcode-terminal@^0.12`) to avoid silent breakage on upstream updates.
- Bridge dir is owned by the per-tenant service account; only that account (and the local admin group) can read the session state.
- Only ONE relay per company. Installing relay-discord or relay-slack overwrites RELAY_TYPE.
