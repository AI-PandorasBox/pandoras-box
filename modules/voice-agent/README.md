# voice-agent

Per-tenant voice (TTS / STT) task agent for Pandora's Box v0.5.x.

## Status

Real -- ships full runtime, plist template, install path via `lib/setup-tenant-runtimes.sh`.

## What it does

Polls the per-tenant `jobs.db` for `APPROVED` jobs with `task_type='voice'` and executes them via the Claude Agent SDK in a tightly-scoped tool environment:

- **TTS via ElevenLabs** -- generates narration / chapter audio / voice-cloned speech, writes mp3 into `<tenant>/store/voice-output/<job-id>.mp3`.
- **STT via Groq Whisper** -- transcribes audio attachments, writes transcript text into `<tenant>/store/voice-output/<job-id>.txt`.

Both providers are optional and detected per-poll from `<tenant>/.env`:

```
ELEVENLABS_API_KEY=...     # enables TTS
GROQ_API_KEY=...           # enables STT
```

With neither set, the agent stays alive, logs a single "no provider" line every 5 minutes, and processes nothing.

## Scope + security

| Allowed | Blocked |
|---|---|
| `WebFetch` | every `mcp__(ms365\|gmail\|google)__*` tool |
| `Bash` -- but only `curl` to `api.elevenlabs.io` or `api.groq.com` | `Write` / `Edit` / `MultiEdit` / `NotebookEdit` |
| Reading + writing files inside `<tenant>/store/voice-output/` | Bash containing `rm -rf` / `sudo` / `nc` / `dd` / `chmod 777` / `/dev/tcp/` / `curl -o /...` |

Bash command bodies are inspected at `canUseTool` time before any shell runs.

The conductor's `canUseTool` separately enforces the per-job retry cap and the standard mail/calendar/files isolation, so a voice job cannot use this agent to read business mail or calendar even if a malicious prompt asks it to.

## Voice config

Per-tenant config at `<tenant>/store/voice-config.json`:

```json
{
  "voices": {
    "narrator": "21m00Tcm4TlvDq8ikWAM",
    "interviewer": "ErXwobaYiN019PkySvjV"
  },
  "default_voice_id": "21m00Tcm4TlvDq8ikWAM"
}
```

The operator-supplied job prompt determines which voice the agent uses for any TTS call. If neither the prompt nor the config specifies a voice and the operator did not allow-list any, the agent refuses the job.

## Job shape

Operator (via conductor) inserts an `APPROVED` row with prompt like:

```
TTS: Generate audio for the following text using the narrator voice.
"In the beginning..."
```

The agent reads the prompt, calls ElevenLabs via the SDK's `Bash` + `curl`, writes the resulting mp3 to `<tenant>/store/voice-output/<job-id>.mp3`, then returns a JSON envelope:

```json
{ "output_path": ".../<job-id>.mp3", "kind": "tts", "duration_seconds": 12.4 }
```

## Cost gates

Defaults inherited from the mail/calendar/files agents:

- `MAX_BUDGET_USD=5` -- per-job SDK spend cap (env-overridable)
- `MAX_TURNS=10` -- per-job SDK conversation turn cap
- `TOOL_RETRY_CAP=10` -- per-tool-name per-job call cap

ElevenLabs + Groq API costs are operator-paid and not counted by the SDK's budget cap; configure your own ElevenLabs character cap in the dashboard.

## Audit log

All events land in `<tenant>/logs/audit.log` (JSONL, shared with the other task agents in the canonical `{ts, source, slug, task_type, ...event}` shape):

```
agent_started, agent_stopped
no_provider
job_started, job_completed, job_failed
tool_span (per Bash / WebFetch invocation)
tool_denied (with reason: out_of_scope | bash_command_not_in_allowlist | retry_cap_hit)
stale_job_recovered
budget_kill
```

## Install path

Installed alongside the other task agents by `lib/setup-tenant-runtimes.sh` on company creation. The voice LaunchDaemon is loaded only when `VOICE_ENABLED=true` is set in `<tenant>/.env`.

## Uninstall

`launchctl unload /Library/LaunchDaemons/com.pandoras-box.<slug>-voice.plist`, then `sudo rm` the plist and the `<tenant>-voice/` runtime dir. Operator-generated audio in `<tenant>/store/voice-output/` is preserved.
