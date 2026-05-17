# personal-ai

> **Personal AI Assistant**

**Status:** Recommended
**Depends on:** core
**Default port:** 8800

## What It Does

A localhost-first browser chat UI for a Claude-backed personal assistant.
Conversation memory persists in a local SQLite database; every turn is also
mirrored to a daily JSONL log for downstream optimisation tools.

Functional surface:

- Multi-conversation chat with history, titles, and recall
- Server-Sent Events streaming for token-by-token replies
- Pinned "important facts" injected into the system prompt every turn
- Drops -- saved notes, links, and file references
- Per-message rating, regeneration, and correction flags (for self-improvement)
- Optional browser-side voice input (Web Speech API)
- Optional ElevenLabs TTS for assistant replies
- Themable -- colour palette and assistant name from `theme.conf`

## Requirements

- `core` module installed (provides `theme.conf` and the `pandoras-box` user)
- Node.js 22 or later (`node:sqlite` and built-in `fetch`)
- Anthropic API key, supplied via one of:
  1. macOS Keychain: `security add-generic-password -a $USER -s pbox-anthropic-key -w <key>`
  2. Env var `ANTHROPIC_API_KEY` in the module `.env`
  3. `~/.config/claude/credentials.json` (Claude CLI auth)

Optional:

- `ELEVENLABS_API_KEY` (env) enables the `/api/tts` proxy
- `PERSONAL_AI_TAILSCALE_ONLY=1` restricts access to Tailscale CIDRs
- `PERSONAL_AI_VOICE=1` shows the mic button (browser STT only)

## Monthly Cost

Anthropic API usage only. Typical light operator use: 1-5 USD per month at
the default `claude-sonnet-4-6` model. Heavy use with long histories: 10-30 USD.
ElevenLabs (if enabled) is billed separately by ElevenLabs.

## How It's Wired

| Component | Path |
|---|---|
| Daemon label | `com.pandoras-box.personal-ai` |
| Runtime | `/opt/pandoras-box/personal-ai/pbox-personal-ai.mjs` |
| Public assets | `/opt/pandoras-box/personal-ai/public/` |
| SQLite store | `/opt/pandoras-box/personal-ai/store/memory.db` |
| JSONL sessions | `/opt/pandoras-box/personal-ai/store/sessions/YYYY-MM-DD.jsonl` |
| `.env` | `/opt/pandoras-box/personal-ai/.env` (mode 600) |
| Logs | `/tmp/pandoras-box-personal-ai.log` |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/`                                | public  | Login page or chat UI |
| GET  | `/avatar.gif`                       | public  | Avatar (theme.conf or SVG fallback) |
| POST | `/api/login`                        | public  | Verify passphrase, set session cookie |
| POST | `/api/logout`                       | session | Clear cookie |
| GET  | `/api/health`                       | public  | Service info (no secrets) |
| POST | `/api/chat`                         | session | Send a message, await full reply |
| GET  | `/api/chat/stream`                  | session | SSE token stream |
| GET  | `/api/conversations`                | session | List conversations |
| GET  | `/api/conversations/:id/messages`   | session | List messages in a conversation |
| GET  | `/api/important_facts`              | session | List pinned facts |
| POST | `/api/important_facts`              | session | Pin a fact |
| GET  | `/api/drops`                        | session | List saved drops |
| POST | `/api/drops`                        | session | Save a drop |
| POST | `/api/messages/:id/rate`            | session | Rate a message (-1, 0, 1) |
| POST | `/api/tts`                          | session | ElevenLabs TTS proxy (if key set) |

All mutating endpoints require a matching CSRF cookie + header.

## Installation

```bash
sudo bash modules/personal-ai/install.sh
```

You will be prompted for a passphrase. PBKDF2 (200k iterations, sha256) hashes
it locally; the plaintext is not stored.

To re-run installation cleanly:

```bash
sudo rm -rf /opt/pandoras-box/personal-ai
sudo bash modules/personal-ai/install.sh
```

## Verify

```bash
curl -s http://127.0.0.1:8800/api/health | python3 -m json.tool
sudo launchctl list | grep com.pandoras-box.personal-ai
tail -20 /tmp/pandoras-box-personal-ai.log
```

Then open `http://127.0.0.1:8800/` in a browser and sign in.

## Security

- All endpoints except `GET /`, `GET /avatar.gif`, `GET /api/health`, and
  `POST /api/login` require a valid session cookie.
- Passphrase: PBKDF2 200000 iterations, sha256, 16-byte random salt,
  timing-safe comparison.
- Cookies: HttpOnly + SameSite=Strict; Secure when behind TLS.
- CSRF: double-submit cookie pattern; rejected on mismatch.
- No outbound network calls except to `api.anthropic.com` (always) and
  `api.elevenlabs.io` (only if a key is configured).
- Static file serving is sandboxed to `public/`; path traversal blocked.
- No shell execution -- all subprocesses use `execFileSync` with arg arrays.

## Uninstall

```bash
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.personal-ai.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.personal-ai.plist
```

This does not delete conversation history. To purge:

```bash
sudo rm -rf /opt/pandoras-box/personal-ai/store
```
