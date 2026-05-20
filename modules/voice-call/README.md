# voice-call

Per-tenant real-time voice call orchestrator. Bridges a browser-default loopback audio session to Gemini Live so the operator can hold a real-time voice conversation with the agent.

## Status

Real -- ships full runtime, browser UI, plist template. Persistent daemon (not a job poller).

## What it does

```
browser  <-- HTTP + WSS -->  pbox-voice-call (this)  <-- WSS -->  Gemini Live
```

- HTTP server at `http://127.0.0.1:${VOICE_CALL_PORT}/` serves a minimal call UI.
- WSS endpoint `/call/ws` accepts PCM 16 kHz mono audio from the browser (mic capture) and emits PCM 24 kHz mono back (Gemini-synthesised speech).
- The daemon translates between the two WSS protocols + does cost accounting per session.

## v0.5.x scope

Conversation only. **In-call tool dispatch is NOT supported in v0.5.x.** The conductor's `jobs.db` IPC is async; routing a tool call through it during a live call would introduce multi-second latency that breaks the voice UX. v0.6 will add a synchronous conductor API + in-call tool routing.

What you can do today:

- Voice-driven conversation (Q&A, narrative practice, dictation)
- System-prompt seeding via `<tenant>/store/voice-call-config.json`
- Voice selection (Aoede / Charon / Fenrir / Kore / Puck)
- Mid-call text input fallback (typed text goes to the same Gemini session)

What you cannot do today:

- "Check my calendar" mid-call (no calendar-agent dispatch)
- "Send an email to X" mid-call (no mail-agent dispatch)
- Multi-session concurrent calls

## Required env (in `<tenant>/.env`)

| Key | Required? | Default | Purpose |
|---|---|---|---|
| `GOOGLE_API_KEY` | yes | -- | Authenticates the WSS to `generativelanguage.googleapis.com` |
| `VOICE_CALL_PORT` | no | `8800` | HTTP + WSS bind port (loopback) |
| `VOICE_CALL_BIND` | no | `127.0.0.1` | Bind address (loopback-only by default) |
| `VOICE_CALL_MODEL` | no | `models/gemini-2.0-flash-exp` | Gemini Live model |
| `VOICE_CALL_VOICE` | no | `Aoede` | One of Aoede / Charon / Fenrir / Kore / Puck |
| `VOICE_CALL_SYSTEM` | no | -- | System prompt to seed each call |
| `VOICE_CALL_MAX_SECONDS` | no | `3600` | Hard cap per session (cost safety) |

## Per-tenant config

Override `VOICE_CALL_*` env per call from `<tenant>/store/voice-call-config.json`:

```json
{
  "system_prompt": "You are Alex, the receptionist for Acme Ltd. Keep answers brief.",
  "voice":         "Aoede",
  "model":         "models/gemini-2.0-flash-exp"
}
```

The config file is read on every new call (no daemon restart needed when you edit it).

## Cost tracking

Per-session lines appended to `<tenant>/store/voice-call-cost.jsonl`:

```json
{"ts":"2026-05-18T22:00:00.000Z","session_id":"vc-...","slug":"acme","audio_seconds_in":42.3,"audio_seconds_out":58.1,"est_cost_usd":0.04149,"rate_card_version":"2025-q4"}
```

Rates baked into the daemon are best-effort (`audio_in_per_sec=$0.000150`, `audio_out_per_sec=$0.000600` from 2025-q4 Gemini Live pricing). Operators are responsible for confirming the live rate card; the seconds-streamed fields are the authoritative input for an exact cost.

The browser UI shows a live in-call cost estimate using the same rate-card numbers.

## Loopback-only

Both the HTTP surface and the WSS upgrade are explicitly gated to `127.0.0.1` / `::1` / `::ffff:127.0.0.1`. The daemon will return 403 on any non-loopback connection. Set `VOICE_CALL_BIND` deliberately if you need to bind elsewhere (e.g. on a Tailscale interface).

## Security envelope

- The daemon connects to Gemini Live with the tenant's `GOOGLE_API_KEY`. No other secrets are passed across the WSS.
- The browser audio capture requires a one-time `getUserMedia` permission grant from the operator. Captured audio is sent to Google as part of the conversation -- this is the operator-acceptable trade implicit in using a managed voice service.
- There is no transcript persistence beyond the in-browser UI by default. Add a `<tenant>/logs/voice-call-transcripts/` writer if you need durable records (not shipped in v0.5.x).
- The `<tenant>/logs/audit.log` (canonical shape) records: `service_started`, `service_stopped`, `call_started`, `call_ended`, `gemini_live_setup`, `gemini_error`, `gemini_closed`. No audio bytes are written to the audit log.

## Install path

Installed alongside the task agents by `lib/setup-tenant-runtimes.sh`. The voice-call LaunchDaemon is loaded only when `GOOGLE_API_KEY` is set in `<tenant>/.env`.

## Uninstall

`launchctl unload /Library/LaunchDaemons/com.pandoras-box.<slug>-voice-call.plist`, then remove the plist + the `<tenant>-voice-call/` runtime dir. Cost log lines in `<tenant>/store/voice-call-cost.jsonl` are preserved.
