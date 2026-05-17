# Changelog

All notable changes to Pandoras Box are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Installer (v0.2.0 -- step-by-step + module pickers + Claude-first)

- **No-liability disclaimer gate.** Installer's first action is a typed-acceptance gate covering: AI agents take real-world actions, the user is responsible for those actions, third-party costs are the user's, pre-release software / no support guarantees, no financial / legal / medical advice, data on the user's machine is the user's responsibility. Any input other than typed `yes` exits the installer cleanly without making any changes.
- **Standardised info card** before every optional module / per-module credential collection. Each card shows: what it does, what you'll need, third-party costs (specific £/$ figures where known), and install time estimate. The same format is used in all 18 module pickers.
- **Telegram setup, per company.** BotFather walkthrough, paste token, paste chat ID (auto-detected via `getUpdates` after the user sends `/start`), live test message via `sendMessage`. Optional -- companies can be browser-only.
- **Encrypted backups module.** Installs `age` via Homebrew, generates a keypair, stores the private key in macOS Keychain (`pbox-backup-age`), offers off-box copy options (USB / paper / print to terminal), installs daily backup LaunchAgent (03:30) + Sunday freshness probe LaunchAgent (07:30), writes a plaintext `RECOVERY.md` outside the encrypted blob.
- **Gemini AI Pro module.** Installs `@google/gemini-cli`, runs `gemini auth login` browser OAuth, copies tokens into a vaulted dir (chmod 660 -- not 640, hard rule), installs 30-min refresh LaunchAgent. Optional paid Google API key for Lyria/Veo behind a daily £ cap. Powers Personal Assistant's Create-tab tools (grounded search, deep research, image gen).
- **ElevenLabs voice module.** Wired into the Personal Assistant flow. Validates API key against `/v1/user`, prompts for voice ID with three sensible defaults, generates a live 5-second sample to confirm.
- **Brave Search module.** API key collection + validation against the `web/search` endpoint. Lets the assistant do live web search (the Offline Knowledge Library offline knowledge is preferred for stable reference content; Brave is for current events).
- **Obsidian vault sub-step in Personal Assistant.** Connects the assistant to a local Obsidian vault. Validates the path looks like a vault (`.obsidian` folder present), creates a writable subfolder (`Pandoras Box/`) so the assistant cannot edit existing notes unless asked, and offers to index the vault on first run.
- **the Personal Sensor Layer + Watch module (one bundle).** Sensor layer + smartwatch surface together. Captures named places (geofencing addresses), watch platform choice (Wear OS / Apple Watch / both / none), and Active Mode default schedule (start hour, end hour, weekend on/off).
- **the Offline Knowledge Library offline knowledge module.** Disk-space precheck (60 GB minimum), Docker check + auto-install, ZIM source picker (Wikipedia, Stack Overflow, iFixit, Project Gutenberg, Khan Academy). Backgrounded download with progress log.
- **Discord / Slack / WhatsApp relays.** Each independent. Discord: app + bot + user ID. Slack: app + bot token + user ID. WhatsApp: explicit unofficial-bridge risk acknowledgement before any setup, separate-number recommendation.
- **the Trading Research Agent (trading) module.** Mandatory typed `I understand` risk acknowledgement before any setup. Demo-only by default; production switch is a SEPARATE script (`trading-research-go-live.sh`) requiring 14+ days of demo verification first. Captures IG demo creds + pool size + drawdown circuit thresholds (daily / weekly / monthly halt) + autonomy envelope (position cap, sector cap, approval ceiling) + strategy selection (A B C D G H by default).
- **the Media Production Pipeline (YouTube channel) module.** Captures YouTube channel ID + Google Cloud OAuth client + music-gen source choice (Suno / Lyria / none) + approval routes (email / Telegram).
- **Video publisher module.** Reuses the Media Production Pipeline's YouTube auth if installed; otherwise collects its own.
- **Website builder module.** FTP/SFTP host + credentials with live FTP login test.
- **Mail-Google (Gmail / Workspace) per-company.** Alternative to MS365 in `setup-company.sh`. OAuth client ID + secret + mailbox to read.
- **Desktop launchers.** Optional clickable .app shortcuts on the Desktop for Dashboard / Terminal / Personal Assistant -- AppleScript wrappers around the right URLs. No more remembering ports.
- **Hardened sanitization gate.** `.sanitize-patterns` now lists 100+ patterns covering API key shapes, OAuth token shapes, GPS coordinate patterns, MAC address patterns, common credential headers (`Authorization: Bearer`), PEM private key fragments, and any maintainer-specific tells. The gate is enforced as a hard exit from `deploy.sh` -- the public push refuses if any pattern hits.

### Added (carried into v0.2.0 from late v0.1.x)

- **Action management tools** in Personal Assistant (personal-ai): `list_actions`, `edit_action`, and `delete_action` tools allow reviewing, modifying, and removing pending actions from the Actions tab before they execute.
- **Watch companion voice calls**: Voice call support added to the watch-companion module. Audio streams over Tailscale to the host voice call server (`com.pandoras-box.muse-call`, port 8890), routed through speech-to-text, the personal AI, and text-to-speech. No port forwarding required.
- **the Personal Sensor Layer ambient signal layer**: Health intelligence service (`com.pandoras-box.personal-sensor-signals`) runs every 60 minutes. Evaluates calendar proximity, unread email count, system alerts, and health signals. Writes structured state for the personal AI to read. No LLM cost at this layer -- the personal AI decides whether to surface an alert or queue an action.

### Changed

- Conductor LLM routing hardened: Ollama auto-detection at startup with clean fallback to the Anthropic API when unavailable. No external service dependency required for baseline operation.
- **the Media Production Pipeline module** documentation corrected to reflect actual implementation: autonomous 8-hour ambient music video pipeline using ElevenLabs Music API and FFmpeg, with YouTube upload and manual approval gate. Prior description ("Content & Social Pipeline") was aspirational rather than accurate.
- **the Offline Knowledge Library module** documentation corrected to reflect actual implementation: offline knowledge engine backed by a Kiwix server serving ZIM files (Wikipedia, Stack Overflow, iFixit, Khan Academy, Project Gutenberg). Qdrant vector RAG remains an optional alternative for document-based retrieval. Prior description ("Knowledge Base (Vector RAG)") inverted the primary and secondary approaches.

---

## [0.1.0] -- 2026-04-20

Initial public release.

### Core System

- Four-tier agent architecture: admin agent, oversight, conductors, task agents
- SQLite job queue at `/var/ai-jobs/jobs.db` with per-company partitioning
- OS-level tenant isolation via dedicated macOS service accounts (UID 401-409)
- Security Overseer (Argus) with active blocking enabled by default
- 60-second job approval cycle with anomaly detection
- Automatic quarantine of agents with repeated failures
- `canUseTool` interceptor enforcing per-agent tool allowlists
- Message integrity checking on all inter-process job payloads
- Watchdog daemon with file integrity monitoring (08:00 and 20:00 daily)
- Automated dependency and security scanning (Thursdays 17:30)

### Installer

- Interactive installer (`pbox-setup.sh`) with step-progress tracking
- One-liner install command: `bash <(curl -fsSL .../install.sh)`
- Path A (personal/solo) and Path B (service provider/managed) setup flows
- Tailscale detection and guided installation
- Automated self-signed TLS certificate generation (CA + server cert)
- Microsoft 365 OAuth credential collection and token cache setup
- Google Workspace OAuth credential collection
- Spend limit walkthrough (mandatory -- cannot be skipped)
- 8 theme presets (Greek, Norse, Egyptian, Roman, Arthurian, Cosmic, Elemental, Celestial) + Custom
- Service provider path with client onboarding tooling

### Modules (20 total)

- **core**: conductor + task agent architecture, job queue, Argus integration
- **personal-ai**: Personal Assistant browser UI (port 9000), briefings, unified inbox, research, voice
- **mail-ms365**: Microsoft 365 email via Microsoft Graph API
- **mail-google**: Gmail via Google OAuth
- **calendar**: Calendar integration (auto-detects MS365 or Google)
- **files**: SharePoint or Google Drive document access
- **admin-lite**: Mobile-friendly admin panel (Tailscale-gated, PIN lockout)
- **dashboard**: Local service status dashboard
- **terminal**: Browser-based terminal with passphrase authentication
- **docs-server**: Local documentation server (all 8 manuals)
- **ollama**: Local LLM for message classification (gemma3:12b default)
- **relay-discord**: Discord relay
- **relay-slack**: Slack relay
- **relay-whatsapp**: WhatsApp relay (unofficial bridge -- see module README)
- **watch-companion**: Pixel Watch notifications and quick replies
- **trading-research**: Trading and investment signals (requires brokerage API credentials)
- **media-production**: Social media and content publishing pipeline
- **offline-kb**: Knowledge RAG with vector store (Qdrant)
- **self-improvement**: Agent self-improvement pipeline (GEPA, skill library, session search)
- **video-publisher**: Automated video production and YouTube publishing (ElevenLabs + ffmpeg)

### Documentation

- 8 PDF manuals: Getting Started, Installation, System Administrator, Security, Personal Assistant, Company Agents, Module Reference, Troubleshooting
- Architecture reference, security model, multi-tenant isolation guide, module catalog
- Sanitization scanner (`hooks/pre-push`) with pattern file for pre-push protection
- GitHub Actions CI: sanitization check + syntax validation on all PRs
- GitHub Actions release: automated tarball build and release asset generation

### Requirements

- macOS 14 (Sonoma) or later
- Node.js 20 or later
- Homebrew
- Anthropic API key (claude-sonnet-4-x or claude-haiku-4-x recommended)
- 8 GB RAM minimum (16 GB recommended for Ollama module)
- 20 GB free disk space minimum

---

[Unreleased]: https://github.com/AI-PandorasBox/pandoras-box/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AI-PandorasBox/pandoras-box/releases/tag/v0.1.0
