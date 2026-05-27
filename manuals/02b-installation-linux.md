# Installation Guide (Linux)

**Audience:** New users installing on Linux for the first time. No deep technical background assumed.
**Platforms:** Debian 13 (Trixie) or Ubuntu 24.04 LTS or later, on a systemd-based system, 64-bit (amd64).

> This is the Linux companion to **Manual 02 (Installation)**, which is written for macOS.
> The same `install.sh` runs on both platforms and detects your OS automatically. The
> screens, the disclaimer gate, theme selection, Claude sign-in, the spending-limit gate,
> Microsoft 365 / Google company setup, and the Telegram walkthrough are **identical** on
> Linux, so they are not repeated in full here. Everything that differs on Linux is below.

---

## Before you begin

### What you will need

- A 64-bit (amd64) machine running **Debian 13 (Trixie)** or **Ubuntu 24.04 LTS** or later. Both use systemd by default, which is what the installer targets.
- A user account with `sudo`.
- **Node.js 20 or later** (the Personal AI module needs **22+** for `node:sqlite` and built-in `fetch`).
- An Anthropic account (Claude Pro or Pro Max recommended; no API key needed up front).
- Microsoft 365 or Google Workspace credentials for each company you connect (optional).
- A free Tailscale account (optional, for phone/remote access).
- Roughly 2-3 hours for a full first install with one company.

### Disk encryption (decide this at OS-install time)

Your agents hold credentials and personal data at rest, so full-disk encryption matters. Set it
up **when you install the operating system**: the Debian and Ubuntu installers both offer
*Guided -- use entire disk and set up encrypted LVM*, which gives you LUKS full-disk encryption
with a passphrase entered at boot. Pandoras Box cannot retrofit disk encryption afterwards; if you
already installed without it, reinstalling with encrypted LVM is cleaner than converting a
populated disk in place.

> The macOS "iCloud pre-flight" note in Manual 02 does not apply to Linux. Simply do not install
> into a cloud-synced directory (Dropbox/Drive). `/opt/pandoras-box` is the default and is fine.

---

## Step 1: Install prerequisites (Linux)

Open a terminal.

```
sudo apt update
```

Install Node.js (22+), git, curl, and CA certificates. If your distro's Node is older than 22, use NodeSource:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git curl ca-certificates
node --version          # expect v22.x or higher
```

There is no Homebrew on Linux -- the installer uses `apt` for any system packages it needs.

---

## Step 2: Set up Tailscale (optional, Linux)

```
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up
```

`tailscale up` prints a URL; open it, sign in, and join your tailnet. Install Tailscale on your
phone and other devices the same way the macOS guide describes.

---

## Step 3: Run the installer

```
bash <(curl -fsSL https://raw.githubusercontent.com/AI-PandorasBox/pandoras-box/main/install.sh)
```

or, from a clone:

```
git clone https://github.com/AI-PandorasBox/pandoras-box.git
cd pandoras-box
bash install.sh
```

`install.sh` detects Linux and runs the Linux setup path. It will ask for your password (sudo) to
create the service accounts and install the systemd services.

---

## Steps 4 to 9: identical to macOS

Follow **Manual 02**, the steps are the same on Linux: the disclaimer gate, theme selection, the
Claude browser sign-in, the mandatory spending-limit gate, certificates, Microsoft 365 / Google
company setup, the Personal AI, optional modules, and system verification.

The Linux-specific differences inside those steps:

| Step | macOS | Linux |
|------|-------|-------|
| Claude / secret storage | macOS Keychain | encrypted file under `/opt/pandoras-box/.secrets` (mode 600) |
| Certificates | `security add-trusted-cert` into the System keychain | copied to `/usr/local/share/ca-certificates/` + `update-ca-certificates` |
| Services | launchd `.plist` in `/Library/LaunchDaemons` | systemd units `pbox-<name>.service` in `/etc/systemd/system` |
| Desktop shortcuts | `.app` bundles on the Desktop | `.desktop` entries in `~/.local/share/applications/` and on the Desktop |
| Backups module | age tarball + launchd schedule | deferred on Linux for now (systemd timer port pending); the rest of the install is unaffected |

---

## Step 10: Verify

```
systemctl list-units --type=service | grep pbox
```

Every Pandoras Box service should show `active (running)`. To read one service's log:

```
journalctl -u pbox-personal-ai -n 50
```

Replace `pbox-personal-ai` with the relevant unit. Open the Personal AI in a browser at
`https://<your-host>:8800/` (or via Tailscale from your phone). If a service is not running, see
**Manual 08 (Troubleshooting)**.

---

## How Linux differs from macOS (summary)

| Area | macOS | Linux |
|---|---|---|
| Service manager | launchd (`launchctl`) | systemd (`systemctl` / `journalctl`) |
| Package manager | Homebrew | `apt` |
| Secrets at rest | macOS Keychain | encrypted file under `/opt/pandoras-box/.secrets` |
| Desktop shortcuts | `.app` bundles | `.desktop` entries |
| CA trust | System keychain | `update-ca-certificates` |
| Disk encryption | FileVault | LUKS (set at OS install) |

Everything above the substrate -- the agents, the Argus oversight model, the Personal AI browser
UI, the modules -- is the same on both platforms.
