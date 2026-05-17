# Installation Guide

**Version:** 0.2.0
**Audience:** New users installing for the first time. No technical background assumed.

---

## Disclaimer

This software is provided under the MIT License on an "as-is" basis, without warranty of
any kind.

The installer's first prompt (after the welcome banner) is a typed-acceptance disclaimer
covering: AI agents take real-world actions on your behalf; you are responsible for those
actions; third-party costs are yours; this is pre-release software with no support
guarantees; nothing in this software is financial / legal / medical advice; data on your
Mac is your responsibility (the optional backups module helps with the first part).

You must type `yes` (lowercase, the full word) to proceed. Any other input exits the
installer cleanly without making any changes to your Mac.

---

## How error handling works

Step 1 of the installer is to install Claude (the AI command-line tool from Anthropic)
and brief it about your install. From that point on, if anything goes wrong on any later
step, you will see this prompt:

```
  ─────────────────────────────────────────────────
  ERROR: Installer hit an error (exit 1)
  Failing command:  sudo dscl . -create /Users/example
  ─────────────────────────────────────────────────

  Ask Claude to help diagnose this? [Y/n]
```

Press Return (or `Y`). Claude reads the install log, identifies what went wrong, and
tells you the exact command to fix it -- in plain English, no technical jargon. Then
re-run the installer.

You do not need to know what a permission error, stack trace, or shell exit code is.

---

## Before You Begin

Read this section fully before running the installer.

### What you will need

- Mac with macOS 14 (Sonoma) or later
- Node.js 20 or later (`brew install node`)
- Homebrew (see brew.sh)
- An Anthropic API key (from console.anthropic.com)
- Microsoft 365 or Google Workspace credentials for each company you are connecting
- A free Tailscale account (tailscale.com)
- Approximately 2-3 hours for a full installation with one company

### What the installer does NOT do

The installer guides you through the setup. It does not:
- Access your email, calendar, or documents on its own
- Send anything without your approval
- Store your credentials anywhere other than this Mac

---

## Step 1: Install Prerequisites

Open the Terminal application on your Mac.

**How to open Terminal:** Press Command + Space, type "Terminal", press Return.

### Install Homebrew (if not already installed)

Homebrew is the standard package manager for macOS. It installs and updates software.

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Paste this into Terminal and press Return. Follow the on-screen instructions. When it asks
for your password, type your Mac login password (the characters will not appear -- this is normal).

If Homebrew is already installed, you will see a message saying so. That is fine -- skip ahead.

### Install Node.js

Node.js is the software that runs the AI agents.

```
brew install node
```

After it finishes, verify it worked:

```
node --version
```

You should see something like `v20.x.x` or `v22.x.x`. Any version 20 or higher is correct.

---

## Step 2: Set Up Tailscale

Tailscale creates a private network between your devices. It means you can access your AI
system from your phone or laptop -- securely, from anywhere -- without exposing it to the
internet.

**Why you need this:** Without Tailscale, your AI system is only accessible on your home
or office network. With Tailscale, you can check in from your phone while travelling.

### Create a Tailscale account

1. Go to tailscale.com
2. Click "Get started"
3. Sign in with your Google or GitHub account (no new password needed)

### Install Tailscale on this Mac

1. Go to tailscale.com/download/mac
2. Download the installer (`.pkg` file)
3. Open it and click through the installation steps
4. A Tailscale icon appears in your menu bar (top right of screen)
5. Click the icon -> "Log in" -> sign in with your Tailscale account

### Install Tailscale on your other devices

After setup, install Tailscale on your phone and any other device you want to use:
- iPhone: App Store -> search "Tailscale" -> install -> sign in with same account
- Android: Play Store -> search "Tailscale" -> install -> sign in
- Other Mac: tailscale.com/download/mac

Full Tailscale setup guide: see `docs/tailscale.md`

---

## Step 3: Run the Installer

Download the Pandoras Box installer files to a convenient location (e.g. your Desktop).

Then run:

```
sudo bash pbox-setup.sh
```

When prompted for a password, enter your Mac login password.

The installer will guide you through the following steps, each explained below.

---

## Step 4: Choose Your Setup Path

The installer asks:

```
What are you setting up?
  1) Personal / Single Organisation
  2) Service Provider
```

**Most users choose option 1.** Choose option 2 only if you are setting up Pandoras Box
as a managed service to run on behalf of multiple paying clients.

---

## Step 5: Choose Your Theme

The installer offers 8 themes. The theme sets the names used throughout your system:
your System Administrator, your Security Overseer, your Personal Assistant, and the Alert Relay.

All themes are identical in functionality. The names are cosmetic.

```
1) Greek      -- [Admin], [Security], [Personal AI]    [default]
2) Norse      -- [Admin], [Security], [Personal AI]
3) Egyptian   -- [Admin], [Security], [Personal AI]
... and so on
9) Custom     -- you name everything
```

Example caption: Example: Greek mythology theme shown.

If you are not sure, press Return to accept the default (Greek).

Your theme can be changed later by editing `/opt/pandoras-box/theme.conf`.

---

## Step 6: Anthropic API Key

The installer asks for your Anthropic API key. This is the key that lets your agents use
the Claude AI.

### Getting your key

1. Go to console.anthropic.com
2. Sign in or create a free account
3. Click "API Keys" in the left sidebar
4. Click "Create Key" -> give it a name (e.g. "My AI System") -> create
5. Copy the key (it starts with `sk-ant-`)

Paste the key into the installer when prompted. The installer tests the key before continuing.

### What if the test fails?

- "Key rejected": check you copied the full key, including the `sk-ant-` prefix
- "Cannot reach server": check your internet connection
- "Unexpected response": try again. If it persists, check console.anthropic.com for outages.

---

## Step 7: Set Spending Limits (MANDATORY)

**This step must be completed before your agents start running.**

A spending limit is a cap on how much the Anthropic API will charge you in a month.
Without a spending limit, a misconfigured agent could run up an unexpected bill.

The installer cannot proceed past this point without your confirmation that limits are set.

### How to set limits

1. Open console.anthropic.com/settings/limits in your browser
2. Set a **soft limit** (email warning) -- recommended starting value: $20-30
3. Set a **hard limit** (API stops) -- recommended starting value: $50-100
4. Click Save
5. Return to the installer and confirm

You can adjust these limits at any time as you learn your actual usage.

**Why this matters:** The installer was designed this way deliberately. Every user must
explicitly acknowledge and set cost limits before any agent becomes active.

---

## Step 8: Security Certificates

The installer generates a security certificate for your system. Certificates enable
encrypted HTTPS connections and are required for some browser features to work.

The installer:
1. Creates a Certificate Authority (CA) on this Mac
2. Generates a server certificate
3. Installs the certificate on this Mac automatically
4. Saves a copy to your Desktop (`PandorasBox-CA.crt`)

**You need to install the CA file on your other devices** (phone, iPad, other Macs)
after setup is complete. Full instructions: `docs/certificates.md`.

---

## Step 9: Company Setup

For each company you are connecting, the installer asks:

1. Company name
2. Email system: Microsoft 365 or Google Workspace
3. Your Microsoft Azure app credentials or Google OAuth credentials

### Microsoft 365 setup

You need an Azure app registration. This is a one-time step that tells Microsoft to trust
your AI system.

Full steps:
1. Go to portal.azure.com and sign in with your Microsoft 365 admin account
2. Search for "App registrations" -> New registration
3. Name: "Your AI System" -> Register
4. Copy the Application (client) ID and Directory (tenant) ID
5. Go to "API permissions" -> Add -> Microsoft Graph -> Application permissions
   Add: Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, Files.ReadWrite.All
   Click "Grant admin consent"
6. Go to "Certificates & secrets" -> New client secret -> copy the Value (shown once)

Paste these values into the installer when prompted.

After the installer completes, you will need to run the Microsoft 365 authentication
flow to authorise the connection. The installer will show you the command.

### Google Workspace setup

You need a Google Cloud project with OAuth credentials.

Full steps:
1. Go to console.cloud.google.com and sign in
2. Create a new project named "Your AI System"
3. Enable: Gmail API, Google Calendar API, Google Drive API
4. Go to APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
5. Application type: Desktop app -> Create
6. Copy the client ID and client secret

Paste these into the installer when prompted.

---

## Step 10: Module Selection

After the core agents and Personal Assistant are configured, the installer offers
optional modules. Each module shows an info card BEFORE the install/skip prompt:

```
  ── Module name ──

  What it does
    One paragraph in plain English explaining the feature.

  What you will need
    A specific list (account on X, API key for Y, disk space, etc.).

  Third-party costs
    Specific figures where known (e.g. "Free tier sufficient", "£5-22/month
    depending on plan", "Pay-per-use behind a daily cap").

  Install time
    Roughly how long this step takes.

  Install Module name? [y/N]:
```

Modules offered:

| Module | Default | Notes |
|---|---|---|
| Encrypted backups | yes | Strongly recommended. age tarball + Sunday probe. |
| Local LLM (Ollama) | no | 16 GB RAM minimum. |
| Status dashboard | yes | Service health + recent jobs page. |
| Browser terminal | no | PBKDF2-auth shell. |
| Admin Lite | no | PIN-locked mobile admin. |
| the Personal Sensor Layer + Watch | no | Sensor layer + smartwatch surface. |
| the Offline Knowledge Library | no | Offline knowledge base. 60+ GB disk. |
| the Self-Improvement Pipeline | no | Self-improvement pipeline. |
| Discord relay | no | If you use Discord. |
| Slack relay | no | If you use Slack. |
| WhatsApp relay | no | UNOFFICIAL bridge -- risk acknowledgement required. |
| the Trading Research Agent (trading) | no | Demo only by default. NOT FINANCIAL ADVICE. |
| the Media Production Pipeline (YouTube) | no | AI music channel pipeline. |
| Video publisher | no | Generic video pipeline. |
| Website builder | no | Static site via FTP. |
| Desktop launchers | yes | .app shortcuts on the Desktop. |

You can add or remove modules at any time after installation by running:
```
sudo bash /opt/pandoras-box/scripts/add-module.sh
```

See Manual 7 (Module Reference) for full per-module documentation.

---

## Step 11: Service Provider Extras (Path B only)

If you selected "Service Provider" at the start, the installer generates:
- A client onboarding script for adding new tenants
- A welcome pack template to send to new clients
- A pricing tier template

These are saved to `/opt/pandoras-box/service-provider/`.

---

## Step 11.5: Telegram setup (per company)

After each company's email/calendar tenant is configured (Step 9), the installer
asks if you want to set up a Telegram bot for that company. Each company gets its
own bot. The bot is the messaging surface -- you message your AI through Telegram
and it routes the request to the right agent.

The walkthrough:

1. Open Telegram (phone or desktop), search for `@BotFather`, send `/newbot`.
2. Pick a friendly name (`Acme Assistant`) and a username ending in `bot`
   (`acme_assistant_bot`). The username must be unique across Telegram.
3. BotFather replies with a token (`123456789:AAH...xyz`). Paste it.
4. Find your chat with the bot you just made and send `/start`.
5. Press Return in the installer. It looks up your chat ID via the Telegram API.
6. The installer sends a test message. Check your Telegram to confirm.

Optional -- if you skip this, the company's conductor still works; you just send
commands via the browser admin panel instead.

---

## Step 12: Final System Check

The installer runs a verification pass at the end:

```
SYSTEM CHECK
  Core system          PASS
  Security Overseer    PASS
  Company: [name]
    Mail agent         PASS
    Calendar agent     PASS
    Files agent        PASS
  Personal Assistant   PASS
  Tailscale            PASS
  Certificates         PASS
```

If any item shows FAIL, the installer explains the cause and the fix command.

A PASS here means the service started correctly. See the Post-Install Verification section
below for functional testing.

---

## Post-Install Verification

After the installer completes, do these checks manually:

### 1. Check all services are running

```
launchctl list | grep pandoras-box
```

Every service should appear in the list. If any are missing, see Manual 8 (Troubleshooting).

### 2. Test your Personal Assistant

Open your relay channel (Telegram, Discord, or Slack -- whichever you configured) and
send a test message to your Personal Assistant. Ask something simple: "What day is it?"

You should receive a reply within a few seconds.

### 3. Test email access

Ask your company agent to check for recent email:
```
"What emails did [company name] receive today?"
```

If the agent cannot access email, the Microsoft 365 or Google authentication flow may
need to be completed. The installer shows you the command to run.

### 4. Install the CA certificate on your phone

Copy `PandorasBox-CA.crt` from your Desktop to your phone and install it.
Full instructions: `docs/certificates.md`.

### 5. Access the Admin Panel from your phone

With Tailscale running on your phone, open the browser and go to:
```
https://[your-tailscale-address]:8787
```

You should see the Admin Panel login screen.

---

## After Installation: What to Read Next

- **Manual 3** -- System Administrator Guide: how to monitor, restart, and maintain
- **Manual 5** -- Personal Assistant User Manual: how to use your Personal Assistant
- **Manual 6** -- Company Agents Guide: how to use your company agents
- **Manual 4** -- Security Guide: understanding the security model
