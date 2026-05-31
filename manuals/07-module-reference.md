# Module Reference

**Version:** 1.0  
**Audience:** Anyone selecting or managing modules

---

## Disclaimer

This software is provided under the Apache 2.0 License on an "as-is" basis, without warranty.
Module costs are estimates only. You are responsible for verifying pricing with each
third-party service provider. Nothing here constitutes financial advice.

---

## How Modules Work

The core system includes everything needed to run company agents and a Personal Assistant.
Modules are optional extensions that add specific capabilities.

**To install a module:**
```
sudo bash /opt/pandoras-box/scripts/add-module.sh
```

**To remove a module:**
```
sudo bash /opt/pandoras-box/scripts/remove-module.sh [module-name]
```

Removing a module stops the related services and removes their configuration.
It does not delete any underlying data (emails, calendar events, documents).

---

## Core Modules

---

### core

**Status:** Required

The foundation. Installs the four-tier agent architecture, the SQLite job queue,
the Security Overseer, and the base conductor and task agents for each company.

**What breaks if not installed:** Everything. All other modules depend on core.

**Prerequisites:**
- macOS 14 or later
- Node.js 20 or later
- Homebrew
- Claude Pro or Max subscription (signed in via `claude /login`)

**Monthly cost impact:** Flat Claude Pro or Max subscription fee

---

### personal-ai

**Status:** Recommended

Your Personal Assistant with a full browser interface. Provides a unified view of all
companies, morning briefings, research, conversation, and task management.

**What breaks if not installed:** You have company agents but no personal AI. Morning
briefings, cross-company views, and conversational assistance are not available.

**Prerequisites:** core, Claude Pro or Max subscription

**Monthly cost impact:** None beyond the flat Claude subscription

---

## Email Modules

---

### mail-ms365

**Status:** Optional

Microsoft 365 email integration via Microsoft Graph API.

Enables Mail Agents to read, send, and search email using Outlook or Exchange.

**What breaks if not installed:** Company agents cannot handle email for Microsoft 365
companies. The Conductor still works -- it just cannot route mail jobs.

**Prerequisites:**
- core
- Microsoft 365 account
- Azure app registration (client ID, tenant ID, client secret)
- Microsoft Graph permissions: Mail.ReadWrite, Mail.Send

**Monthly cost impact:** None (Microsoft 365 subscription cost is separate)

---

### mail-google

**Status:** Optional

Gmail integration via Google OAuth.

Enables Mail Agents to read, send, and search email using Gmail accounts.

**What breaks if not installed:** Company agents cannot handle email for Google Workspace
companies.

**Prerequisites:**
- core
- Google account
- Google Cloud project with Gmail API enabled
- OAuth 2.0 client credentials

**Monthly cost impact:** None (Google Workspace cost is separate)

---

### calendar

**Status:** Optional

Calendar integration. Reads existing events, creates new events, and manages invites.
Auto-detects whether the company uses Microsoft 365 or Google Calendar.

**What breaks if not installed:** Calendar queries and meeting briefs are unavailable.
Email and files still work.

**Prerequisites:** core, mail-ms365 or mail-google (at least one)

**Monthly cost impact:** Minor additional Anthropic API usage for calendar queries

---

### files

**Status:** Optional

SharePoint (Microsoft 365) or Google Drive document access.

**What breaks if not installed:** Document queries and file management are unavailable.
Email and calendar still work.

**Prerequisites:** core, mail-ms365 or mail-google (at least one)

**Monthly cost impact:** Minor additional Anthropic API usage for document queries

---

## Interface Modules

---

### admin-lite

**Status:** Optional

Mobile-friendly Admin Panel, accessible via Tailscale from any device.

Provides PIN-protected access to service status, logs, job queue, and command sending
from a phone or tablet.

**What breaks if not installed:** Remote admin from mobile is unavailable. The Dashboard
(local network) still works.

**Prerequisites:** core, Tailscale installed

**Monthly cost impact:** None

---

### dashboard

**Status:** Optional

Local service status Dashboard. A web page on your local network showing all running
services, recent job activity, and system health.

**What breaks if not installed:** No visual service overview. You can still check
status via the terminal.

**Prerequisites:** core

**Monthly cost impact:** None

---

### terminal

**Status:** Optional

Browser-based Terminal with passphrase authentication. Accessible on your local network.

**What breaks if not installed:** Browser terminal unavailable. Standard macOS Terminal
app still works.

**Prerequisites:** core

**Monthly cost impact:** None

---

### docs-server

**Status:** Optional

Local Documentation Server. Renders the Pandoras Box manuals as a navigable website
on your local network.

**What breaks if not installed:** Manuals only accessible as raw Markdown files.

**Prerequisites:** core

**Monthly cost impact:** None

---

## AI and Infrastructure Modules

---

### ollama

**Status:** Optional

Local LLM for message classification. Runs on your Mac and handles high-volume tasks
without calling the Anthropic API, significantly reducing costs.

The default model is `gemma3:12b`. Conductors detect Ollama automatically and fall back
to the Anthropic API if it is unavailable.

**What breaks if not installed:** All AI processing uses the Anthropic API. Higher costs
for high-volume usage. No functional difference in output quality.

**Prerequisites:**
- core
- 16 GB RAM minimum
- Ollama installed (`brew install ollama`)
- `gemma3:12b` model pulled (`ollama pull gemma3:12b`)

**Monthly cost impact:** Reduces Anthropic API costs by 30-70% for active use

---

### offline-kb

**Status:** Optional

Knowledge RAG (Retrieval-Augmented Generation). A vector store for document retrieval
that enables agents to search a curated knowledge base for relevant context before
generating responses.

Reduces AI hallucination for domain-specific or internal knowledge queries.

**What breaks if not installed:** Agents answer from training knowledge only. For general
questions this is fine. For questions about your specific internal documents or policies,
accuracy may be lower without the Offline Knowledge Library.

**Prerequisites:**
- core
- Docker (runs the Kiwix container)
- a ZIM pack (the installer offers Wikipedia and others)

**Monthly cost impact:** None -- Kiwix runs locally over offline ZIM files.
(For semantic recall over your own content, see the vector-kb module.)

---

## Relay Modules

---

### relay-discord

**Status:** Optional

Discord relay. Receive messages from a Discord server and reply through the same channel.

**Prerequisites:**
- core
- Discord bot token
- Discord server with the bot invited and appropriate permissions

**Monthly cost impact:** None

---

### relay-slack

**Status:** Optional

Slack relay. Receive messages from Slack and reply via the same workspace.

**Prerequisites:**
- core
- Slack app with `chat:write` and `channels:history` scopes
- Slack OAuth token

**Monthly cost impact:** None

---

### relay-telegram

**Status:** Optional

Telegram bot relay. Talk to your assistant from Telegram via a long-poll bot,
with an optional single-chat allowlist so only your chat ID is accepted.

**Prerequisites:**
- core
- Telegram bot token (from @BotFather)

**Monthly cost impact:** None

---

### relay-whatsapp

**Status:** Optional

WhatsApp relay via an unofficial bridge.

**Important:** Verify compliance with WhatsApp platform terms of service before
deploying in a production environment. Unofficial bridges may violate terms of service.
Use at your own risk.

**Prerequisites:**
- core
- WhatsApp account
- Compatible bridge software installed and authenticated

**Monthly cost impact:** None

---

## Specialist Modules

---

### watch-companion

**Status:** Optional

Pixel Watch companion for notifications and quick replies.

Delivers morning briefing summaries and system alerts as watch notifications. Supports
quick-reply actions for common commands.

**Prerequisites:**
- core
- personal-ai
- Android phone with companion app installed
- Pixel Watch paired to the phone

**Monthly cost impact:** None

---

### trading-research

**Status:** Optional

Trading and investment signals module. Monitors a watchlist, tracks technical and
event-driven signals, and surfaces opportunities in your morning briefing.

**Important:** the Trading Research Agent is not a financial advice service. All signals require human review
before action. Trading involves significant risk of loss. You are responsible for all
trading decisions and their outcomes.

**Prerequisites:**
- core
- Brokerage or market data API credentials
- Funded account with a supported data provider

**Monthly cost impact:** £10-20 additional Anthropic API usage due to signal processing frequency

---

### media-production

**Status:** Optional

Social media and content publishing pipeline. Produces drafts, manages a content queue,
and publishes on instruction after your approval.

**What it requires for publishing:**
- API credentials for each platform you want to publish to

**Monthly cost impact:** £5-15 additional Anthropic API usage depending on publishing volume

---

### self-improvement

**Status:** Optional

Agent self-improvement pipeline. Analyses agent performance logs on a weekly schedule,
generates prompt adjustment proposals (GEPA), and applies approved proposals automatically.

Also includes a skill library with a 72-hour review interval.

Over time, the Self-Improvement Pipeline helps your agents improve their accuracy and relevance based on actual
usage patterns -- without requiring manual prompt engineering.

**Prerequisites:** core, personal-ai

**Monthly cost impact:** Minor (weekly review batch, not continuous)

---

### video-publisher

**Status:** Optional

Automated video production and YouTube publishing.

Combines script generation, voice synthesis (ElevenLabs), and video assembly (ffmpeg)
to produce and publish videos automatically. Integrates with the the Media Production Pipeline content queue
for scheduling.

**Prerequisites:**
- core
- ElevenLabs API key
- ffmpeg installed (`brew install ffmpeg`)
- YouTube Data API v3 credentials with upload permissions
- media-production recommended for content queue integration

**Monthly cost impact:** ElevenLabs voice synthesis cost depends on script length (typically
£1-5 per video); Anthropic API for script generation (£2-5 per video)

---

## Memory and Knowledge Modules

---

### vector-kb

**Status:** Optional

Local semantic memory. Embeds your text with a local Ollama model and stores the
vectors in SQLite for nearest-neighbour search, so the assistant can recall the
most relevant past context for a query.

**Prerequisites:** core, ollama (for embeddings)

**Monthly cost impact:** None (local embeddings, local store)

---

### vault-graph

**Status:** Optional

Renders the assistant's memory as a browsable, linked Obsidian vault on disk,
viewable in Obsidian's graph view.

**Prerequisites:** core, personal-ai

**Monthly cost impact:** None

---

### data-import

**Status:** Optional

Imports existing memories from another assistant (Markdown notes, vault exports
and similar) into your Personal Assistant's memory.

**Prerequisites:** core, personal-ai

**Monthly cost impact:** None

---

## Security Modules

---

### content-classifier

**Status:** Recommended

Localhost content-safety classification sidecar. Screens outbound content across
six axes (prompt safety, response safety, response refusal, prompt toxicity,
response toxicity, jailbreak detection). Ships in shadow mode (observe-only) for
a calibration period before it blocks anything.

**Prerequisites:** core, Python 3.11+ (Homebrew-managed)

**Monthly cost impact:** None (local CPU inference)

---

### argus

**Status:** Always installed

The Security Overseer daemon. Reviews every pending job (via the
content-classifier) before execution, quarantines repeat offenders, and runs a
weekly dependency scan. Cannot be instructed by any agent.

**Prerequisites:** core, content-classifier

**Monthly cost impact:** None

---

## Additional Specialist Modules

---

### browser-actions

**Status:** Optional

Interactive browser surface for agents (navigate, read, click, type, screenshot)
via a local Playwright browser. Gated by an access token, a domain allowlist
(deny by default), and an audit log.

**Prerequisites:** core, Playwright (installed by the module)

**Monthly cost impact:** None

---

### deck-builder

**Status:** Optional

Builds PowerPoint decks (.pptx) from a simple JSON spec, locally via python-pptx.

**Prerequisites:** core, Python 3.11+ with python-pptx

**Monthly cost impact:** None

---

### skills-library

**Status:** Optional

Reusable skill primitives the assistant and company agents can call (for example,
building a board pack from a calendar). Add your own under the module's skills dir.

**Prerequisites:** core

**Monthly cost impact:** None

---

## UI Modules in Detail

The following sections describe the user interface modules in more detail.

---

### Admin Shell

The Admin Shell is a Chrome desktop application. It opens on your Mac like any other app.

**How to access:** Click the Admin Shell icon in your Dock or Applications folder.

**What it looks like:** A dark-themed browser window with tabs for:
- Status (live service health, green/amber/red indicators)
- Logs (searchable log viewer, all services)
- Queue (job queue with status filters)
- Projects (autonomous build project list)
- Deploy (deploy controls, DRY_RUN toggle)

**What you can do:**
- See at a glance which services are running
- Search logs for errors across all services
- Monitor job queue activity
- Review and approve build projects
- Run a deploy

---

### Dashboard

The Dashboard is a web panel accessible on your local network.

**How to access:** Open a browser on any device on your home or office network and go to
`http://[your-mac-hostname].local:8181`

Example caption: Example: Greek mythology theme shown.

**What it looks like:** A dark dashboard with service tiles, a recent jobs feed, and a
system health summary.

**What you can do:**
- Quick service status overview
- See recent job activity across all companies
- No controls -- read-only view

---

### Terminal

The browser-based Terminal is a command-line interface in a browser tab.

**How to access:** `http://[your-mac-hostname].local:8282`

**What it looks like:** A classic terminal emulator in a browser window. Black background,
monospace font.

**Authentication:** Passphrase required on each session.

**What you can do:** Anything you can do in the macOS Terminal -- run commands, check logs,
restart services.

---

### Admin Panel (Lite)

The mobile-friendly Admin Panel is gated behind Tailscale.

**How to access:** `https://[your-tailscale-address]:8787` from any Tailscale device.

**What it looks like:** A minimal, touch-friendly interface optimised for phone screens.

**Authentication:** PIN code required (5 failed attempts triggers a 15-minute lockout).

**What you can do:**
- Check service status
- Restart a service
- View recent jobs
- Send a command to an agent
- View the last 50 log lines per service

---

### Personal Assistant Browser Interface

The full Personal Assistant browser interface.

**How to access:** `https://[your-tailscale-address]:8800`

**What it looks like:** A full-featured chat interface with a sidebar showing recent
conversation history, quick-action buttons, and a settings panel.

Example caption: Example: Greek mythology theme shown.

**What you can do:**
- Full conversation with your Personal Assistant
- Upload files for discussion (drag and drop)
- Access conversation history and search past interactions
- Configure briefing settings
- View and manage memory
- Access links to your company agents

---

### Documentation Server

A local web server that hosts these manuals.

**How to access:** `http://[your-mac-hostname].local:8485`

**What it looks like:** A clean documentation site with navigation for all manuals.

**What you can do:** Read any manual in a formatted, searchable browser interface.
