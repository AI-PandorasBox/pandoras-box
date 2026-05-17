# media-production -- Requirements

## Runtime

- macOS with `launchctl` (LaunchDaemons)
- Node.js 22 or later (the worker uses the `fetch` builtin, `AbortController`,
  and `node:fs/promises`)
- No npm dependencies. The runtime imports only Node builtins.

## Credentials (set in `.env`, one per backend you intend to use)

| Backend             | Env var                  | Purpose                                    |
|---------------------|--------------------------|--------------------------------------------|
| Suno (music)        | `SUNO_API_KEY`           | `music` jobs (experimental; see README)    |
| ElevenLabs          | `ELEVENLABS_API_KEY`     | `narration` jobs                           |
| ElevenLabs voice    | `MEDIA_NARRATION_VOICE_ID` | Default voice id when job omits one       |
| Google AI (Imagen)  | `GOOGLE_AI_KEY`          | `image` jobs                               |
| Google AI (Veo)     | `GOOGLE_AI_KEY`          | `video` jobs (same key as Imagen)          |

Missing keys are tolerated: only jobs of the affected kind fail; the worker
itself continues to run.

## Filesystem layout

```
${INSTALL_PATH}/media-production/
  pbox-media-production.mjs   -- runtime
  .env                        -- credentials + config (chmod 600)
  store/queue/<job-id>.json   -- job files (chmod 750 dir)
  output/<job-id>/            -- per-job outputs (chmod 750 dir)
```

## Network egress

The worker contacts exactly four external hosts, each only when a job of the
corresponding kind is processed:

- `studio-api.suno.ai`
- `api.elevenlabs.io`
- `generativelanguage.googleapis.com` (Imagen + Veo + Veo polling)

No telemetry, no auto-update, no other outbound traffic.

## Optional inbound port

If `MEDIA_PRODUCTION_HTTP=1`, the worker binds `127.0.0.1:${MEDIA_PRODUCTION_PORT:-8486}`
for local job submission. Not exposed to LAN.
