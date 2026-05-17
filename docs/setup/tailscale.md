# Setup — Tailscale (mobile-to-Pbox mesh VPN)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

Pandora's Box is hosted on a Mac in your home or office. Your phone, tablet, laptop, and any other operator devices need to reach that Mac to use the Personal AI from outside the local network. Tailscale provides a free mesh VPN that solves this without exposing your Mac to the public internet.

## Why Tailscale specifically

Alternatives exist (WireGuard, ZeroTier, Cloudflare Tunnel). Tailscale is recommended because:

- Free tier covers personal use (up to 100 devices, no functional limits).
- macOS native client with Keychain integration.
- iOS / Android / Windows / Linux clients all work the same way.
- Zero port forwarding on your router. NAT traversal is automatic.
- ACL system means your phone can reach the Mac without giving every device on Tailscale that access.

If you'd rather use a different mesh VPN, the install logic only depends on "your phone can resolve a hostname or static IP to the Mac". Swap accordingly.

## Setup steps

### 1. Install Tailscale on the Mac (the Pandora's Box host)

```
brew install --cask tailscale
```

Open the Tailscale app (it lives in the menu bar after first run). Sign in with whichever identity you want to control the tailnet — Google, Microsoft, GitHub, Apple, or email-based.

### 2. Note the Mac's tailnet hostname

In the Tailscale app, the Mac shows up with a hostname like `mac-mini.tailnet-name.ts.net`. That's the address your phone uses to reach Pandora's Box from outside the home network.

### 3. Install Tailscale on your phone

- iOS: Tailscale app from the App Store, sign in with the same identity as step 1.
- Android: Tailscale app from Google Play, same identity.

The phone now appears in your tailnet alongside the Mac.

### 4. Verify

On the phone, open Safari (iOS) or Chrome (Android) and navigate to:
```
https://mac-mini.tailnet-name.ts.net:8888/
```

(Substitute your actual tailnet hostname.) You should see the Pandora's Box Personal AI sign-in screen.

### 5. Optionally restrict access via ACLs

By default any device in your tailnet can reach the Mac. If you want only the operator's devices to reach the AI, edit your tailnet ACLs at https://login.tailscale.com/admin/acls/file to restrict the Mac's port 8888 to specific device tags.

This is optional for personal use but recommended if you've added family-member devices to the tailnet for other reasons.

## What Pandora's Box uses Tailscale for

- **Personal AI mobile interface** — phone or tablet reaches `https://<mac-hostname>:8888/`.
- **WatchMuse companion app** (if installed) — talks to mnemosyne over Tailscale on port 8888.
- **Operator remote access** — if you're away from the Mac, you can still reach the admin agent CLI via SSH over Tailscale.

## What Tailscale doesn't do

- It does **not** make your Mac publicly accessible. Only devices signed in to your tailnet can reach it.
- It does **not** route your traffic through Tailscale's servers — peer-to-peer NAT traversal. Tailscale doesn't see the contents of your traffic.
- It does **not** affect existing local-network access. Your LAN still works as normal.

## Troubleshooting

- **Phone can't reach the Mac hostname.** Verify both devices show as "Connected" in the Tailscale admin console. Open the Tailscale app on each and confirm green status.
- **`https://mac-mini.tailnet-name.ts.net:8888` returns a certificate warning.** Expected on first connect — the Pandora's Box mnemosyne UI uses a self-signed certificate by default. Tap "Show details" then "Visit this website" to accept and pin the cert. The installer can also provision a Tailscale-issued HTTPS cert if you'd like to skip this — see the certs setup step.

## Revoking access

Open the Tailscale admin console at https://login.tailscale.com/admin/machines and remove the Mac (or the phone) from your tailnet. The corresponding device immediately loses the ability to reach others over Tailscale.
