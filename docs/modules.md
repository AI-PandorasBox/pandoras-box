<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Module Catalog

This catalog lists all modules available in Pandoras Box. Install only the modules you need.
Optional modules can be added after the initial install using `add-module.sh`.

---

## core

**Status:** Required

The foundation of Pandoras Box: the admin agent, the oversight daemon, the job queue, conductors, and base task agents.

The `core` module installs the four-tier agent architecture, the SQLite job queue, the oversight daemon
oversight, and the base conductor and task agent scripts for each configured company. All other
modules depend on `core`.

**Prerequisites:**
- macOS 14 or later
- Node.js 20 or later
- Homebrew
- Anthropic API key

**Depends on:** none

---

## personal-ai

**Status:** Recommended

Owner personal AI -- browser UI, unified inbox, calendar, and daily briefing.

The Personal AI is the operator-facing AI assistant. It provides a browser-based interface with a unified
view of all companies' inboxes, calendars, and task queues. It generates a morning briefing
and supports natural-language queries across all connected data sources.

**Prerequisites:**
- `core`
- Anthropic API key

**Depends on:** core

---

## mail-ms365

**Status:** Optional

Outlook and Exchange email integration via Microsoft Graph API.

Enables the mail task agents to read, send, and search email using Microsoft 365 accounts.
Requires an Azure app registration with the appropriate Graph API permissions and an OAuth
token per company.

**Prerequisites:**
- `core`
- Microsoft 365 account per company
- Azure app registration with Mail.ReadWrite and Mail.Send permissions

**Depends on:** core

---

## mail-google

**Status:** Optional

Gmail integration via Google OAuth.

Enables the mail task agents to read, send, and search email using Google accounts. Requires
a Google Cloud project with the Gmail API enabled and an OAuth 2.0 credential per company.

**Prerequisites:**
- `core`
- Google account per company
- Google Cloud project with Gmail API enabled

**Depends on:** core

---

## calendar

**Status:** Optional

Calendar integration -- reads and creates events. Auto-detects MS365 or Google based on which
mail module is installed.

Enables the calendar task agents to read schedules, create events, and respond to meeting
requests. Shares the OAuth token established by the mail module.

**Prerequisites:**
- `core`
- `mail-ms365` or `mail-google` (at least one)

**Depends on:** mail-ms365 or mail-google

---

## files

**Status:** Optional

SharePoint or Google Drive document access for reading and writing files.

Enables the files task agents to access documents stored in SharePoint (MS365) or Google Drive.
Uses the same OAuth token as the mail module for the same company.

**Prerequisites:**
- `core`
- `mail-ms365` or `mail-google` (at least one)

**Depends on:** mail-ms365 or mail-google

---

## admin-lite

**Status:** Optional

Mobile-friendly admin panel accessible over Tailscale from any device on your network.

Provides a lightweight web UI for checking service status, viewing logs, and sending commands
to agents. Accessible from phones and tablets via Tailscale -- no port forwarding required.

**Prerequisites:**
- `core`
- Tailscale installed and authenticated on the host machine

**Depends on:** core

---

## dashboard

**Status:** Optional

Local service status dashboard showing the health of all running services and recent job queue
activity.

Displays a real-time view of LaunchDaemon status, recent jobs, Argus decisions, and system
metrics. Accessible on the local network.

**Prerequisites:**
- `core`

**Depends on:** core

---

## terminal

**Status:** Optional

Browser-based terminal with authentication for remote administration.

Provides a web terminal accessible on the local network, protected by a passphrase. Useful for
administration from another machine without SSH.

**Prerequisites:**
- `core`

**Depends on:** core

---

## docs-server

**Status:** Optional

Local documentation server that renders the Pandoras Box docs in a browser.

Serves the contents of `docs/` as a navigable website on the local network. Useful for
referencing architecture and configuration docs without leaving the browser.

**Prerequisites:**
- `core`

**Depends on:** core

---

## ollama

**Status:** Optional

Local LLM for message classification, reducing Anthropic API costs significantly.

When installed, conductors use a locally-running Ollama model (default: `gemma3:12b`) to
classify incoming messages before deciding whether to call the Anthropic API. This reduces
costs for high-volume inboxes. Conductors fall back to the Anthropic API automatically if
Ollama is unavailable.

**Prerequisites:**
- `core`
- 16 GB RAM minimum
- Ollama installed (`brew install ollama`)
- `gemma3:12b` model pulled (`ollama pull gemma3:12b`)

**Depends on:** core

---

## relay-discord

**Status:** Optional

Discord relay -- receive messages and send replies via a Discord bot.

Enables conductors to receive inbound messages from a Discord server and reply through the
same channel. Requires a Discord bot token and a server where the bot has been invited.

**Prerequisites:**
- `core`
- Discord bot token
- Discord server with the bot invited and appropriate channel permissions

**Depends on:** core

---

## relay-slack

**Status:** Optional

Slack relay -- receive messages and send replies via a Slack app.

Enables conductors to receive inbound messages from Slack and reply through the same channel.
Requires a Slack app with the appropriate OAuth scopes.

**Prerequisites:**
- `core`
- Slack app with `chat:write` and `channels:history` scopes
- Slack OAuth token

**Depends on:** core

---

## relay-whatsapp

**Status:** Optional

WhatsApp relay via an unofficial bridge.

Enables conductors to receive and reply to WhatsApp messages using a third-party bridge. Note:
verify compliance with WhatsApp platform terms of service before deploying this module in a
production environment.

**Prerequisites:**
- `core`
- WhatsApp account
- Compatible bridge software installed and authenticated

**Depends on:** core

---

## watch-companion

**Status:** Optional

Pixel Watch companion for notifications and quick replies from your wrist.

Sends Personal AI briefing summaries and conductor alerts as watch notifications. Supports quick-reply
actions for common commands. Requires the companion app installed on an Android phone paired
with a Pixel Watch.

**Prerequisites:**
- `core`
- `personal-ai`
- Android phone with the Pandoras Box companion app installed
- Pixel Watch paired to the phone

**Depends on:** personal-ai

---

## trading-research

**Status:** Optional

Trading signals module. Generates entry and exit signals based on configurable strategies,
with brokerage API integration for automated or semi-automated execution.

Note: this module is not financial advice. Trading involves significant risk of loss. You are
responsible for all trading decisions and outcomes. Review all signals before acting on them.

**Prerequisites:**
- `core`
- Brokerage API key with appropriate permissions
- Funded brokerage account
- Understanding of the risks involved in algorithmic trading

**Depends on:** core

---

## media-production

**Status:** Optional

Social and content publishing pipeline. Automates drafting, scheduling, and publishing content
across configured platforms.

the Media Production Pipeline connects to platform APIs (YouTube, LinkedIn, and others) and manages a content
queue. Draft posts are reviewed via the Personal AI interface before publishing.

**Prerequisites:**
- `core`
- Platform API keys for each target service (YouTube Data API v3, etc.)

**Depends on:** core

---

## offline-kb

**Status:** Optional

Offline encyclopedia search -- a local **Kiwix** server over ZIM packs
(Wikipedia, Wiktionary, Stack Overflow), with a thin search wrapper so agents
can look things up with no internet connection.

> For **semantic memory** (embeddings / vector recall), see the **vector-kb**
> module, not this one. offline-kb is reference content, not your memory.

**Prerequisites:**
- `core`
- Docker (runs the Kiwix container)
- a ZIM pack (the installer offers Wikipedia and others)

**Depends on:** core (Docker)

---

## self-improvement

**Status:** Optional

Agent self-improvement pipeline using GEPA (Generalised Error-driven Prompt Adjustment) and
a skill library.

the Self-Improvement Pipeline runs a weekly review cycle, analysing agent performance logs and generating prompt
adjustment proposals. Approved proposals are applied automatically on the next cycle. Includes
FTS5 session search and a skill library with a 72-hour review interval.

**Prerequisites:**
- `core`
- `personal-ai`

**Depends on:** core, personal-ai

---

## video-publisher

**Status:** Optional

Automated video production and YouTube publishing pipeline.

Combines script generation, voice synthesis (ElevenLabs), and video assembly (ffmpeg) to
produce and publish videos automatically. Integrates with the `media-production` content queue for
scheduling.

**Prerequisites:**
- `core`
- ElevenLabs API key
- ffmpeg installed (`brew install ffmpeg`)
- YouTube Data API v3 credentials with upload permissions

**Depends on:** media-production (recommended)

---

## website-builder

**Status:** Optional

Automated website generation and deployment pipeline.

Generates static websites from a brief and deploys them to a configured hosting provider.
When a company agent receives a website request, it creates a job for the website-builder
module, which builds the site and deploys it via FTP or a supported hosting API.

Review the generated site before publishing -- the agent emails a preview link before any
deployment.

**Prerequisites:**
- `core`
- FTP credentials or hosting API key for the target service

**Depends on:** core
