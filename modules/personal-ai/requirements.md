# personal-ai -- Requirements

## System Requirements

| Requirement | Value |
|-------------|-------|
| `core` module | Required |
| Node.js | 22 or later (built-in `node:sqlite` + `fetch`) |
| macOS | 14 or later (for the LaunchDaemon model used by the installer) |
| Disk | < 100 MB including the SDK and a typical local DB |
| RAM | ~80 MB resident at idle |

## Runtime Dependencies

| Source | Package | Why |
|---|---|---|
| npm | `@anthropic-ai/sdk` | Claude API client (only runtime npm dep) |
| Node built-in | `node:http` | HTTP server |
| Node built-in | `node:sqlite` | Memory store |
| Node built-in | `node:crypto` | PBKDF2, timing-safe-equal, session tokens |
| Node built-in | `node:child_process` | Keychain lookup via `execFile` |

## API Credentials

| Credential | Required | Source priority |
|-----------|----------|------------------|
| Anthropic API key | Yes | (1) macOS Keychain `pbox-anthropic-key`, (2) env `ANTHROPIC_API_KEY`, (3) `~/.config/claude/credentials.json` |
| ElevenLabs API key | No | env `ELEVENLABS_API_KEY` (enables `/api/tts`) |

## Network

- Default bind: `127.0.0.1:8800` (localhost only).
- Outbound to `api.anthropic.com` (HTTPS).
- Outbound to `api.elevenlabs.io` (HTTPS) only if `ELEVENLABS_API_KEY` is set.
- No telemetry, no analytics, no auto-update checks.
- If `PERSONAL_AI_TAILSCALE_ONLY=1`, inbound is restricted to Tailscale CIDRs
  (`100.64.0.0/10` and `fd7a:115c:a1e0::/48`) plus loopback.

## Environment Variables

Read from `${INSTALL_PATH}/personal-ai/.env` (mode 600).

| Variable | Default | Purpose |
|---|---|---|
| `PERSONAL_AI_PORT` | `8800` | TCP port |
| `PERSONAL_AI_BIND` | `127.0.0.1` | Bind address |
| `PERSONAL_AI_NAME` | `Assistant` (from `theme.conf`) | Display name |
| `PERSONAL_AI_MODEL` | `claude-sonnet-4-6` | Anthropic model id |
| `PERSONAL_AI_PASSPHRASE_HASH` | _set by installer_ | `<salt-hex>:<hash-hex>` |
| `PERSONAL_AI_VOICE` | `0` | Show mic button (browser STT) |
| `PERSONAL_AI_TAILSCALE_ONLY` | `0` | Restrict inbound to Tailscale CIDRs |
| `ANTHROPIC_API_KEY` | _none_ | Fallback if Keychain entry absent |
| `ELEVENLABS_API_KEY` | _none_ | Enables TTS proxy |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` | Default ElevenLabs voice |

## Permissions

- LaunchDaemon runs as `${PERSONAL_AI_USER:-<owner-of-install-path>}`.
- Reads from `/opt/pandoras-box/personal-ai/` (750).
- Writes only to `/opt/pandoras-box/personal-ai/store/`.
- No sudo at runtime; no privilege escalation.
