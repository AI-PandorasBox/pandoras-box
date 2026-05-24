# Changelog

All notable changes to Pandoras Box are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added -- Skills Library module

A new optional module (`modules/skills-library`) ships reusable, tenant-agnostic
skill primitives any agent can invoke. First skill: `build_board_pack_from_calendar`
(board-pack PDF from MS365 calendar -- per-week pull with resume, exceljs xlsx
assembly with row-count verification, Chrome-headless PDF render). The installer
copies skills to `shared/skills/library/` and preserves operator-specific branding
presets. Add your own skills under the module's `skills/` dir.

### Added -- Release + commit signing

Commits and tags are SSH-signed and show GitHub's "Verified" badge. Release
artifacts ship a `SHA256SUMS` manifest + detached `SHA256SUMS.sig`; verify a
download with `scripts/verify-release.sh` against `scripts/allowed_signers`
(see `RELEASE-SIGNING.md`).

### Added -- Activation matrix template

`config/agent-activation.template.json` documents the per-agent activation schema
(modules / subsystem_handles / skills / rules / policies / surfaces / stores, plus
`requires` dependency maps) with two illustrative agents.

### Changed -- backups module rebuilt (TCC-hardened LaunchDaemon flavour)

The encrypted backups module has been re-architected. The previous user
LaunchAgent flavour silently failed under macOS Tahoe TCC when reading
`~/Desktop` and `~/Documents`; backups produced 0-byte tarballs and the
`latest` symlink was happily updated each night. This release fixes the silent
failure and adds three operator-visibility features.

**Breaking changes:**

- Daily backup now runs as a root LaunchDaemon (`com.pandoras-box.backup` in
  `/Library/LaunchDaemons/`). The previous user LaunchAgent
  (`~/Library/LaunchAgents/com.pandoras-box.backup.plist`) is no longer used.
- Scripts moved from `$INSTALL_PATH/scripts/` to
  `/Users/Shared/pandoras-box-backup-scripts/` (root:wheel 755).
- Env file moved from `$INSTALL_PATH/backups/.env` to
  `/usr/local/etc/pandoras-box-backup.env` (root:wheel 600).
- Age public key moved from `$INSTALL_PATH/secrets/age-backup-pubkey.txt` to
  `/usr/local/etc/pandoras-box-backup-pubkey.txt` (root:wheel 644). Private
  key in macOS Keychain is unchanged.
- The installer now requires **sudo** for the backups module. The rest of the
  installer is unchanged (user-context).
- The previous Sunday freshness probe (`com.pandoras-box.backup-freshness`)
  is replaced by a per-component size assertion baked into every nightly run.

**Added:**

- Per-component size assertion. If any component comes back empty, the
  `latest` symlink is NOT updated. No more silent zero-byte success.
- Optional daily `[OK]/[FAIL]` email via a user LaunchAgent at 07:00.
  Configurable during install; SMTP creds in the env file.
- Optional Backblaze B2 weekly mirror. Configurable during install; 14-day
  remote retention by default.
- TCC pre-flight: the installer prompts to grant Full Disk Access to
  `/bin/bash` (opens the System Settings pane) before the first scheduled
  run.

**Migration from previous backups install:**

If you ran the previous installer and want to switch:

```bash
# Unload old user LaunchAgents (if present)
launchctl unload ~/Library/LaunchAgents/com.pandoras-box.backup.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.pandoras-box.backup-freshness.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.pandoras-box.backup*.plist

# Re-run the backups setup with the new flavour
sudo bash <PBOX_INSTALL_PATH>/lib/setup-backups.sh
```

Your existing encrypted blobs at `/Users/Shared/pandoras-box-backups/` are NOT
touched -- the migration only swaps the daemon, scripts, env file, and pubkey
location. Your Keychain age private key is unchanged.

**Reason for the change:**

Discovered during an internal incident on 2026-05-20 -- a Pandora's Box
install had been silently producing 0-byte backups since 2026-05-03 because
TCC was blocking the user LaunchAgent from reading `~/Desktop`. The root
LaunchDaemon + per-component assertion + daily email together prevent the
failure mode entirely. The size-assertion catches it on the first run; the
email surfaces it the next morning.


### Runtime code rollout (v0.4.0-rc1 -- six new module daemons)

Resolves Gap #5 from the v0.3 installer audit. Six modules now ship full runtime code following the canonical 5-step `install.sh` + `runtime/<bin>.mjs` + `runtime/com.pandoras-box.<name>.plist.template` pattern.

- **`personal-ai` runtime** -- browser-first chat UI on `127.0.0.1:8800`, PBKDF2 passphrase auth (200000 iters / sha256 / 16-byte salt, timing-safe-equal), SQLite memory at `${INSTALL_PATH}/personal-ai/store/memory.db` (conversations / messages / important_facts / drops), Anthropic SDK proxy via `@anthropic-ai/sdk` (sole new external dep, lazy-imported, key resolution: macOS Keychain `pbox-anthropic-key` -> `ANTHROPIC_API_KEY` env -> Claude CLI credentials), optional ElevenLabs TTS server proxy (env-gated). JSONL session log under `store/sessions/YYYY-MM-DD.jsonl` consumed by `self-improvement` GEPA.
- **`personal-sensor` runtime** -- 10-min ambient signal daemon, SSE endpoint on `127.0.0.1:8489/events`. Signal sources: calendar pull (token-gated by existing `mail-*` module `.env`), free-time gap detection, optional `corelocationcli` geofence. Persistent JSONL log + read-only `/recent?n=N` replay endpoint. Node 22 builtins only -- zero external deps.
- **`offline-kb` runtime** -- Kiwix-serve wrapper on `127.0.0.1:8090` with branded search UI from `theme.conf`. Generates `docker-compose.yml` with `read_only` / `no-new-privileges` / `tmpfs:/tmp` hardening. `/api/search?q=` JSON envelope + streaming `/proxy/*` pass-through to Kiwix at internal `:8089`. SHA256 verification on ZIM downloads (best-effort).
- **`media-production` runtime** -- background queue worker polling `${INSTALL_PATH}/media-production/store/queue/*.json` every 30s. Four backends via `fetch` builtin (no SDK deps): Suno (flagged experimental -- unofficial API), ElevenLabs (narration), Google AI Imagen (image), Google AI Veo (video, with long-running-op polling). Operator fills API keys in `.env`; worker keeps running on missing-key jobs (per-job failure mode). Optional `127.0.0.1:8486` HTTP for job submission.
- **`trading-research` runtime** -- IG demo-only REST client on `127.0.0.1:8490` with mandatory top-of-file `// DEMO-ONLY. NOT FINANCIAL ADVICE.` comment. **Hard gate: refuses to start if `IG_LIVE=true`** (`process.exit(1)`). 50/200 minute-bar MA crossover signals. No order endpoints whatsoever; UI is read-only. `install.sh` step 1 contains static-analysis guard refusing install if the demo-only gate string or demo URL is missing from runtime.
- **`self-improvement` GEPA optimiser** -- deterministic prompt-edit digest from `personal-ai` JSONL session log. Identifies rejected (rating<3) / regenerated / corrected assistant turns; groups by conversation; emits markdown digest to `output/weekly-YYYY-MM-DD.md`. Operator-gated -- never auto-applies. No LLM call; no network. Skill-suggestion heuristic at >=3 distinct conversations per kind.

### Added

- **Dependabot.** `.github/dependabot.yml` -- weekly Monday 06:00 UK scan of github-actions ecosystem, target `dev`. Npm deferred until repo-level `package.json` exists.
- **Shared stub helpers** at `lib/stub-helpers.sh`. Five reusable helpers (`stub_scaffolded_warning`, `stub_check_conductor`, `stub_validate_slug`, `stub_env_set`, `stub_check_node`) sourced by the 7 STUB modules. Standardises the operator UX across `calendar`, `files`, `mail-google`, `mail-ms365`, `relay-discord`, `relay-slack`, `relay-whatsapp` and gives a single place to update when the v0.5.x conductor runtime ships.
- **`uninstall.sh` per STUB module** (7 new). Each reverses its `install.sh`: `sed`s the relevant keys out of `<slug>/.env`, prompts before deleting cached tokens / bridge dirs where applicable, restarts the conductor.

### Changed

- **All 7 STUB modules** (`calendar`, `files`, `mail-google`, `mail-ms365`, `relay-discord`, `relay-slack`, `relay-whatsapp`) rewritten to print a clear "scaffolded -- v0.5.x conductor not yet shipped" warning at install start AND end, so operators are not misled by the install reporting PASS while no agent surface actually runs.
- **STUB README template standardised** across the 7 modules: Status + Depends on + scaffolded warning callout + What It Does + Requirements (full table) + Monthly Cost + How to Install + After Installation + Uninstall + Notes (per-tenant isolation, gotchas).
- **`relay-whatsapp` bridge dir is now per-tenant** (`$INSTALL_PATH/<slug>/whatsapp-bridge/`). Previously a global `$INSTALL_PATH/whatsapp-bridge/` — incompatible with multi-tenant deployment on the same Mac.
- **`relay-whatsapp` npm deps pinned** to `whatsapp-web.js@^1.27` + `qrcode-terminal@^0.12` (previously unpinned latest).
- **`relay-discord` channel ID validated** as a Discord snowflake (17-20 digit numeric) at install time, before writing the env key. Previously accepted any string.
- **`relay-slack` token shape validated** — bot token must start with `xoxb-`, app token with `xapp-`.
- **`mail-google` install.sh** no longer prints misleading "browser will open" prompt during install. The Google OAuth flow runs when the v0.5.x conductor first needs to read mail; install only saves credentials.
- **`mail-ms365` install.sh** no longer attempts to run the `@softeria/ms-365-mcp-server` OAuth flow inline (the package isn't in the company `node_modules` at v0.4 stub time). Now defers to the v0.5.x conductor; pre-creates the token-cache dir with correct permissions.
- **All STUB `.env` writes are idempotent.** `stub_env_set` deletes any existing key= line before appending. Previous behaviour left duplicate `RELAY_TYPE=` lines if the operator switched between relay modules.
- **All STUB installers validate the company slug** against the list of installed companies before writing anything. Previously typo'd slugs silently wrote `.env` to a non-existent path.
- **All STUB installers check Node.js 18+** as a uniform prerequisite (previously inconsistent across the 7).

### Fixed

- **Installer: `RECOMMENDED` modules now actually default to install on accept-all.** `lib/setup-modules.sh` `offer_module` calls for `content-classifier` and `self-improvement` were missing the `"yes"` 6th positional arg, so the menu defaulted them to "no" despite the `[RECOMMENDED]` label.
- **Installer: system-check label cleanup.** `pbox-setup.sh` `run_system_check` was rendering "the Content Classifier content classifier" and "the Self-Improvement Pipeline self-improvement" (double-naming artefact from a Greek-rename sed pass). Cleaned to single-named labels.
- **Installer: dry-run inline-read in content-classifier fail-mode prompt.** The fail-mode choice (`fail-open` / `fail-closed`) used a bare `read -rp`, bypassing the dry-run shim. Wrapped in `PBOX_DRY_RUN_ACTIVE` check defaulting to `closed` so the dry-run no longer hangs.
- **Installer: headless `TERM` crash.** `pbox-setup.sh` `print_banner` calls `clear`, which aborts under `set -e` when bash auto-sets `TERM=dumb` (CI runners, cron, `ssh -T`). Forced `TERM=xterm-256color` early if unset/dumb.
- **Docs: Google AI key placeholder.** `docs/setup/google-ai.md` previously contained an example string starting with `AIza` followed by ~35 alphanumeric characters that matched the credential-shape CI regex `AIza[0-9A-Za-z_-]{35}`. Replaced with a non-matching descriptive form so the placeholder communicates shape without triggering the gate.
- **`trading-research`: port collision with `content-classifier`.** Both modules defaulted to `:8487`. `trading-research` moved to `:8490`.
- **`trading-research`: dry-run staging parity.** Module's `install.sh` short-circuited at steps 2 + 3 in dry-run, leaving target dir + `.env` empty (inconsistent with all other modules). Now always stages files via the sudo shim; writes a placeholder `.env` with `IG_*=dryrun-placeholder` sentinels in dry-run mode.
- **Installer: `install_tenant_runtimes` wired into `setup-company.sh`.** `lib/setup-tenant-runtimes.sh` already shipped (renders per-tenant plists + npm-installs conductor + 3 task agents + conditionally loads LaunchDaemons), but was never sourced or called. Adding a company via `pbox-setup.sh` therefore wrote `.env` + dirs but installed no daemons. Now sourced from `pbox-setup.sh` and invoked at the end of both `setup_company_ms365` and `setup_company_google`. Dry-run flow is unchanged -- the parent `run_company_setup` short-circuits before the call.
- **v0.5.0-rc1 audit pass -- 6 patches.** Static cross-port audit + sandbox + Tart VM verification surfaced 5 cross-port consistency findings + 1 portability glitch.
  - **`files-agent` timestamp units** -- 7 writes used seconds (`Math.floor(Date.now()/1000)`); the contract + the other three agents use milliseconds (`Date.now()`). Self-consistent inside files-agent, but cross-agent comparisons (Argus parsing, future cross-tenant queries) saw two scales coexisting in the same INTEGER column. Aligned to ms throughout; stale-cutoff `- 60` becomes `- 60_000`.
  - **`calendar-agent` BLOCKED_TOOL_PATTERNS** -- the in-file deny `Set` covered only `mcp__ms365__*` tools. A Google-calendar tenant would have unblocked `mcp__gmail__create_event` / `mcp__google__delete_event` unless the operator separately edited `.claude/settings.json`. Replaced with a regex array covering `ms365 | gmail | google` prefixes, matching mail-agent's pattern.
  - **`mail-agent` + `calendar-agent` defensive `ALTER TABLE` on boot** -- files-agent had idempotent migrations for `last_active` / `cost_usd` / `risk_level`; mail + calendar relied on the conductor's `CREATE TABLE` having run first. Clean installs were unaffected, but any older `jobs.db` missing these columns would crash mail/calendar on the first `UPDATE`. Both now run the same migration block on boot (gated on `existsSync(JOBS_DB)`).
  - **Audit log canonical shape** -- four agents diverged: conductor used `src` (others `source`), files-agent used `tenant` (others `slug`), calendar-agent omitted `task_type` (mail/files included it). Canonicalised to `{ts, source, slug, task_type?, ...event}` across all four. Argus + external parsers no longer have to handle three schemas.
  - **`TASK_TYPE` constant** -- mail + calendar allowed an env override (dead code in calendar; AGENT_NAME hardcoded the value anyway). Hardcoded to match files-agent's pattern.
  - **`setup-tenant-runtimes.sh` zsh portability** -- line 50 used unbraced `"$user:staff"`; zsh parsed as a parameter-substring expression and threw "bad substitution". Bash-safe but trips an operator sourcing the file into an interactive zsh. Braced as `"${user}:staff"`.

### CI

- **CodeQL workflow** added then removed -- requires GitHub Advanced Security on private repos, which the AI-PandorasBox account doesn't have. Will reinstate post-public-flip (free for public repos) or post-Advanced-Security purchase.
- **Sanitize workflow now passes all 4 jobs** -- gate-on-the-gate, generic credential-shape scan, `.sh`/`.mjs` syntax validation, installer dry-run smoke on macOS-14 runner. First all-green run since the repo was rewritten on 2026-05-17.

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
