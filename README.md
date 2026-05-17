<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Pandoras Box
<!-- _A1_COVER_PAGE_V1 -->

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-blue.svg)](https://apple.com/macos)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org)
[![Latest Release](https://img.shields.io/github/v/release/AI-PandorasBox/pandoras-box.svg)](https://github.com/AI-PandorasBox/pandoras-box/releases)
[![GitHub Stars](https://img.shields.io/github/stars/AI-PandorasBox/pandoras-box.svg?style=social)](https://github.com/AI-PandorasBox/pandoras-box/stargazers)

Pandoras Box is an open-source multi-agent AI system for Mac. It runs multiple AI assistants simultaneously on a single Mac Mini -- one per company or context -- with strict OS-level isolation between them, an independent oversight daemon that approves every action, and a browser-first personal AI interface for the owner.

The system is designed to handle real business operations: email, calendar, documents, and voice for multiple separate companies from one machine, without any cross-company data exposure. It is built for people who want production-grade AI assistants running on hardware they own and control, not cloud services they depend on.

**Project website + walkthrough:** [ai-pandorasbox.co.uk](https://ai-pandorasbox.co.uk)

> **Note:** Pandoras Box is a macOS-native system. Linux support is planned for a future release.

---

## Key Features

| | |
|---|---|
| **Browser-first Personal AI** | Full Chrome-app interface. Voice-to-voice conversation, screen share, video share, and remote browser control. Phone + watch surfaces for when you're away from the desk. |
| **An Admin agent that runs the platform** | Dedicated administrator oversees every service, runs scripted deploy sessions, holds the systems dashboard, operates a project + multi-project build system, and can spawn its own sub-agents for parallel work. |
| **Per-company agents, compartmentalised** | Each company gets its own assistant -- mail, calendar, files, voice, marketing, web -- isolated at the operating-system level. Separate user accounts, separate credentials, separate job queues, no cross-tenant data path. |
| **Security that acts, not just watches** | Independent oversight daemon approves every queued action. Content classifier sidecar. Lockdown manager quarantines an agent in under 30 seconds. Watchdog runs 13 daily health checks. Weekly dependency scan. Encrypted offsite backup. |
| **Memory built for continuity** | Three working layers -- rolling history, semantic vector recall, and structured knowledge (vault, notes, important facts, drops, relationship graph). On top: a six-worker self-improvement loop with weekly digest. Nothing self-applies without your approval. |
| **Specialised systems for real work** | Offline knowledge library (full Wikipedia + reference packs). Media production pipeline (music + narration + image + video + YouTube). Trading research. Asynchronous deep research. Sandboxed code execution. Live-stream vision. Windows remote diagnostics. Local-model intent routing with frontier fallback. |

Read the full feature deep-dive at [ai-pandorasbox.co.uk](https://ai-pandorasbox.co.uk).

---


## Install

**Instant install (one command):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/AI-PandorasBox/pandoras-box/main/install.sh)
```

**Safer alternative (review before running):**

```bash
curl -fsSL https://raw.githubusercontent.com/AI-PandorasBox/pandoras-box/main/install.sh -o install.sh
# Open install.sh in a text editor and review it
bash install.sh
```

**From a clone:**

```bash
git clone https://github.com/AI-PandorasBox/pandoras-box.git
cd pandoras-box
bash install.sh
```

**Prerequisites:** macOS 14 or later, Node.js 20+, Homebrew, an Anthropic account (Claude Pro or Pro Max recommended).

**You do not need to be technical.** Step 1 of the installer is to install Claude itself and brief it about your install. From that point on, if anything goes wrong on any later step, you press Return at the prompt and Claude reads the install log and tells you what to do next. No prior knowledge of macOS, Node, or shell scripting required.

**An API key is no longer needed up front.** The installer signs you into Claude in the browser the same way the Claude desktop app does. You only need to provide API keys later for *optional* paid services (Google AI for image/video, ElevenLabs for voice, Brave Search for web context, Suno for music) and the installer will tell you which.

**You will be asked to accept a no-liability disclaimer** before any install action. The installer requires you to type `yes` to acknowledge that AI agents take real-world actions on your behalf and you are responsible for them. Any other input exits cleanly without changing your Mac.

See [docs/installation.md](docs/installation.md) for the full step-by-step guide and the [Installation Manual PDF](https://github.com/AI-PandorasBox/pandoras-box/releases/latest) for a printed reference.

---

## Architecture

![Pandoras Box - Six Layer Architecture](docs/architecture/diagrams/overview-designer.svg)

Four tiers. A higher tier cannot be instructed by a lower one.

| Tier | Component | Role |
|------|-----------|------|
| **0** | The admin agent | System administrator. CLI interface (Claude Code). No external connectivity. Manages infrastructure, deploys code, monitors services. |
| **1** | Argus | Independent oversight daemon. Approves or blocks every queued job. Cannot be instructed by any agent. Active blocking enabled by default. |
| **2** | Conductors | One per company. Receives owner messages, classifies intent, routes jobs to the queue. Holds no company credentials. |
| **3** | Task Agents | Mail, Calendar, Files, Voice -- one per function per company. Each holds only its own scoped credentials. Fully OS-isolated from other companies. |

A fifth component -- **the Personal AI** -- is the owner's personal AI interface: a browser-accessible assistant with a unified inbox, calendar view, daily briefing, research, and voice input, drawing on all company contexts simultaneously (read-only).

---

## Technical features in depth

**Tenant isolation.** Each company's agents run as a dedicated macOS service account with no shared credentials, no shared database, and no shared memory. OS-level `750` permissions enforce the boundary.

**Argus oversight.** Every job created by every agent passes through Argus before execution. Argus is a standalone daemon that no agent can instruct or reach. It blocks anomalous jobs, quarantines failing agents, and sends alerts.

**Browser-first Personal AI.** The owner's primary interface is a web app -- no Telegram required for personal use. Accessible over Tailscale or local network from any device. Unified inbox, calendar, daily briefing, research, voice, and more.

**Modular install.** Core system installs cleanly in 15 minutes. Optional modules (Discord relay, Watch companion, trading signals, social pipeline, local LLM, RAG knowledge base) install independently and are fully reversible.

**Local LLM option.** High-volume classification tasks run on a local Ollama instance using an open-weight model (default: gemma3:12b). This eliminates the most frequent API calls and significantly reduces operating costs.

**Self-improvement pipeline.** The Personal AI carries a built-in self-improvement cycle: session compression, skill library, weekly GEPA optimisation proposals, and user-pattern modelling -- all running on a schedule without manual intervention.

**Three-layer sanitization gate.** A local pre-commit hook, a local pre-push hook, and a server-side GitHub Actions workflow all independently scan for credential shapes before any code leaves your machine or lands on the default branch. Operator-specific patterns (your real name, paths, tenants) live ONLY at `~/.config/pandoras-box/sanitize-patterns` -- never inside the repo. The hooks refuse to run if the patterns file ever reappears at the repo root (gate-on-the-gate). See [SECURITY.md](SECURITY.md) for the threat model.

---

## Modules

| Module | Purpose | Description | Docs | Status |
|--------|---------|-------------|------|--------|
| **core** | Base system | admin agent, oversight, job queue, conductors, base task agents | [catalog](docs/modules.md#core) · [admin guide](manuals/03-admin-guide.md) · [architecture](docs/architecture.md) | Required |
| **personal-ai** | Personal AI assistant | Browser UI with unified inbox, calendar, briefing, and research | [catalog](docs/modules.md#personal-ai) · [user manual](manuals/05-personal-assistant-user-manual.md) | Recommended |
| **mail-ms365** | Microsoft email | Outlook/Exchange integration via Microsoft Graph API | [catalog](docs/modules.md#mail-ms365) · [agents guide](manuals/06-company-agents.md) | Optional |
| **mail-google** | Gmail | Gmail integration via Google OAuth | [catalog](docs/modules.md#mail-google) · [agents guide](manuals/06-company-agents.md) | Optional |
| **calendar** | Calendar sync | Calendar integration (auto-detects MS365 or Google) | [catalog](docs/modules.md#calendar) · [agents guide](manuals/06-company-agents.md) | Optional |
| **files** | Document access | SharePoint or Google Drive document retrieval | [catalog](docs/modules.md#files) · [agents guide](manuals/06-company-agents.md) | Optional |
| **admin-lite** | Mobile admin | Mobile-friendly admin panel (Tailscale-accessible) | [catalog](docs/modules.md#admin-lite) · [admin guide](manuals/03-admin-guide.md) | Optional |
| **dashboard** | System monitor | Local service status and health dashboard | [catalog](docs/modules.md#dashboard) · [admin guide](manuals/03-admin-guide.md) | Optional |
| **terminal** | Web terminal | Browser-based terminal with authentication | [catalog](docs/modules.md#terminal) · [admin guide](manuals/03-admin-guide.md) | Optional |
| **docs-server** | Local docs | Local documentation server | [catalog](docs/modules.md#docs-server) · [admin guide](manuals/03-admin-guide.md) | Optional |
| **ollama** | Local LLM | On-device LLM for classification (recommended: gemma3:12b, 16GB RAM) | [catalog](docs/modules.md#ollama) · [module reference](manuals/07-module-reference.md#ollama) | Optional |
| **relay-discord** | Discord relay | Receive and reply to messages via Discord | [catalog](docs/modules.md#relay-discord) · [module reference](manuals/07-module-reference.md#relay-discord) | Optional |
| **relay-slack** | Slack relay | Receive and reply to messages via Slack | [catalog](docs/modules.md#relay-slack) · [module reference](manuals/07-module-reference.md#relay-slack) | Optional |
| **relay-whatsapp** | WhatsApp relay | WhatsApp relay (unofficial bridge -- see module README) | [catalog](docs/modules.md#relay-whatsapp) · [module reference](manuals/07-module-reference.md#relay-whatsapp) | Optional |
| **content-classifier** | Content classifier | Local 0.3B-parameter outbound-content safety scorer (shadow mode by default) | [README](modules/content-classifier/README.md) | Recommended |
| **admin-shell** | Chrome desktop admin app | Standalone Chrome window for the admin shell (alternative UX to admin-lite) | [README](modules/admin-shell/README.md) | Optional |
| **trading-research** | Trading bot | Autonomous trading signals (requires brokerage API credentials) | [catalog](docs/modules.md#trading-research) · [module reference](manuals/07-module-reference.md#trading-research) | Optional |
| **media-production** | Content pipeline | Social media and content publishing automation | [catalog](docs/modules.md#media-production) · [module reference](manuals/07-module-reference.md#media-production) | Optional |
| **offline-kb** | Knowledge base | Vector RAG store for document retrieval and Q&A | [catalog](docs/modules.md#offline-kb) · [module reference](manuals/07-module-reference.md#offline-kb) | Optional |
| **self-improvement** | Self-improvement | Agent self-analysis and prompt optimisation pipeline | [catalog](docs/modules.md#self-improvement) · [module reference](manuals/07-module-reference.md#self-improvement) | Optional |
| **video-publisher** | Video production | Automated video production and YouTube publishing | [catalog](docs/modules.md#video-publisher) · [module reference](manuals/07-module-reference.md#video-publisher) | Optional |
| **backups** | Encrypted offsite-ready backups | Daily age-encrypted tarball + Sunday freshness probe | [README](modules/backups/README.md) | Recommended |
| **personal-sensor** | Personal intelligence layer | Ambient sensor daemon + Watch companion (Wear OS / Apple Watch) | [README](modules/personal-sensor/README.md) | Optional |
| **desktop-launchers** | Desktop shortcuts | .app launchers on the Desktop for Dashboard / Terminal / Assistant | [README](modules/desktop-launchers/README.md) | Recommended |
| **website-builder** | Static site publisher | AI-managed brochure site via FTP/SFTP | [README](modules/website-builder/README.md) | Optional |

Full module documentation: [docs/modules.md](docs/modules.md)

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Four-tier design, security layers, component reference |
| [Security](docs/security.md) | Isolation model, Argus design, threat model, automated defences |
| [Multi-Tenant Setup](docs/multi-tenant.md) | Running multiple companies on one machine |
| [Modules](docs/modules.md) | Complete module catalog with prerequisites |

**PDF Manuals** -- download from [GitHub Releases](https://github.com/AI-PandorasBox/pandoras-box/releases/latest):

| Manual | Description |
|--------|-------------|
| Getting Started | System overview, costs, and hardware requirements |
| Installation Guide | Step-by-step install with screenshots |
| System Administrator Guide | Service management, monitoring, projects |
| Security Guide | Threat model, incident response, architecture detail |
| Personal Assistant User Manual | Personal AI features: briefings, inbox, research, voice |
| Company Agents Guide | Mail, Calendar, Files agents, AaaS model |
| Module Reference | All modules with prerequisites and costs |
| Troubleshooting Guide | Symptom, cause, and fix for common issues |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs, submit pull requests, and contribute new modules.

Security issues: see [SECURITY.md](SECURITY.md). Do not report security vulnerabilities via public GitHub Issues.

---

## Disclaimer

This software is provided as-is under the Apache 2.0 License. See [DISCLAIMER.md](DISCLAIMER.md) for the full disclaimer covering AI output, API costs, security, and compliance responsibilities. By installing and running Pandoras Box you accept the terms in DISCLAIMER.md.

---

## License

Apache 2.0 -- see [LICENSE](LICENSE)
