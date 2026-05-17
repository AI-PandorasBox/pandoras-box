# media-production

> **Background queue worker for music + narration + image + video generation.**

**Status:** Optional
**Depends on:** core

## What It Does

Runs as a LaunchDaemon. Polls a queue directory every 30 seconds for JSON job
files, dispatches each job to one of four third-party APIs, and writes the
output to a per-job directory under `output/<job-id>/`.

Supported job kinds:

| `kind`       | Backend                       | Output                          |
|--------------|-------------------------------|---------------------------------|
| `music`      | Suno (`studio-api.suno.ai`)   | `music.mp3`                     |
| `narration`  | ElevenLabs                    | `narration.mp3`                 |
| `image`      | Google AI Imagen 3            | `image-1.png` ... `image-N.png` |
| `video`      | Google AI Veo (long-running)  | `video.mp4`                     |

All HTTP traffic uses the Node `fetch` builtin. No third-party SDKs, no npm
dependencies.

### Suno API availability

**STATUS: experimental -- Suno public API availability uncertain; verify
before production use.** At the time of writing, Suno does not publish a
stable public API. The integration targets `POST https://studio-api.suno.ai/api/generate/v2/`
which is the surface used by their unofficial wrappers; this may break,
change shape, or require swapping to a different provider. Treat `music`
jobs as best-effort. The other three backends are stable public APIs.

## Job File Shape

Job files live in `${INSTALL_PATH}/media-production/store/queue/<job-id>.json`:

```json
{
  "job_id": "ab12cd34ef56",
  "kind": "narration",
  "params": {
    "text": "Hello world.",
    "voice_id": "<elevenlabs-voice-id>"
  },
  "status": "pending",
  "created_at": "2026-05-17T10:00:00Z",
  "updated_at": "2026-05-17T10:00:00Z"
}
```

`status` transitions: `pending` -> `running` -> `complete` | `failed`.

On completion the worker writes `output_path` into the job file. On failure
the worker writes `error` with the failure reason.

### Per-kind `params`

- **music**: `{ prompt, instrumental?, model? }`
- **narration**: `{ text, voice_id?, model_id?, voice_settings? }` (`voice_id`
  falls back to `MEDIA_NARRATION_VOICE_ID` env)
- **image**: `{ prompt, count?, aspect_ratio? }` (count 1-4)
- **video**: `{ prompt, aspect_ratio?, duration_seconds? }`

## Optional Local HTTP Submission Surface

Set `MEDIA_PRODUCTION_HTTP=1` in `.env` to bind a localhost-only HTTP server
on port `MEDIA_PRODUCTION_PORT` (default `8486`). Endpoints:

- `POST /api/jobs`  -- submit a job (`{kind, params}` JSON body), returns `{job_id, status}`
- `GET  /api/jobs`  -- list all jobs
- `GET  /api/jobs/:id` -- read one job
- `GET  /api/health` -- liveness probe

No auth: the surface binds to `127.0.0.1` only, matching the same
operator-machine-only posture as the `terminal` module. Do not expose this
port to other hosts.

## Environment Variables

Set in `${INSTALL_PATH}/media-production/.env` (chmod 600):

| Variable                       | Purpose                                              |
|--------------------------------|------------------------------------------------------|
| `SUNO_API_KEY`                 | Required for `music` jobs                            |
| `ELEVENLABS_API_KEY`           | Required for `narration` jobs                        |
| `MEDIA_NARRATION_VOICE_ID`     | Default ElevenLabs voice if job omits `voice_id`     |
| `GOOGLE_AI_KEY`                | Required for `image` and `video` jobs                |
| `MEDIA_PRODUCTION_HTTP`        | `1` to enable local HTTP submission, `0` to disable  |
| `MEDIA_PRODUCTION_PORT`        | HTTP port (default `8486`)                           |
| `MEDIA_PRODUCTION_BIND`        | HTTP bind address (default `127.0.0.1`)              |
| `MEDIA_PRODUCTION_QUEUE_DIR`   | Queue dir override                                   |
| `MEDIA_PRODUCTION_OUTPUT_DIR`  | Output dir override                                  |
| `MEDIA_PRODUCTION_POLL_MS`     | Poll interval (default `30000`)                      |

If a required key is missing for a given job kind, the worker marks that
specific job `failed` with a clear `error` message and continues running.

## Cost Estimates (typical hobbyist usage)

These are order-of-magnitude only; check each provider's current pricing.

- **ElevenLabs narration**: roughly £5-22/month for a Creator/Pro tier
  subscription; or pay-as-you-go ~£0.15 per minute of audio.
- **Imagen 3**: ~£0.03 per generated image.
- **Veo**: significantly more expensive; ~£0.20-0.50 per second of generated
  video depending on tier. A 30-second clip can cost several pounds.
- **Suno**: subscription tier required (Pro/Premier ~£8-24/month) plus
  the API caveat above.

Set monthly spend caps in each provider's console. The worker does not
itself enforce a budget.

## How to Install

```sh
sudo bash modules/media-production/install.sh
```

The installer:

1. Verifies Node 22+ is on PATH
2. Stages the runtime + queue + output dirs into `${INSTALL_PATH}/media-production/`
3. Writes a default `.env` (operator must fill in API keys)
4. Renders and validates the LaunchDaemon plist (`plutil -lint`)
5. Loads the LaunchDaemon and reports status

After install, edit `${INSTALL_PATH}/media-production/.env` and add the API
keys for the backends you intend to use, then restart the daemon:

```sh
sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.media-production.plist
sudo launchctl load   /Library/LaunchDaemons/com.pandoras-box.media-production.plist
```

### Dry run

Set `PBOX_DRY_RUN=1` before running `install.sh` to stage files and render
the plist without calling `launchctl` and without contacting any external
API. No keys are validated in dry-run mode.

## How to Verify

1. `launchctl list | grep com.pandoras-box.media-production` -- daemon registered
2. `tail -f /tmp/pandoras-box-media-production.log` -- structured JSON logs
3. Drop a sample job into the queue dir:

   ```sh
   cat > /tmp/test-job.json <<'EOF'
   {
     "job_id": "test001",
     "kind": "narration",
     "params": { "text": "Hello.", "voice_id": "<voice>" },
     "status": "pending",
     "created_at": "2026-05-17T10:00:00Z",
     "updated_at": "2026-05-17T10:00:00Z"
   }
   EOF
   sudo cp /tmp/test-job.json /opt/pandoras-box/media-production/store/queue/test001.json
   sudo chown <service-user> /opt/pandoras-box/media-production/store/queue/test001.json
   ```

   Within 30 seconds the worker should mark `status: running` then either
   `complete` (with `output_path`) or `failed` (with `error`).

## Uninstall

```sh
sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.media-production.plist
sudo rm /Library/LaunchDaemons/com.pandoras-box.media-production.plist
sudo rm -rf /opt/pandoras-box/media-production
```

## Out of Scope (v0.4)

YouTube upload, video editing, automatic captioning, watermarking. Video
publishing is handled by the separate `video-publisher` module (deferred
to v0.5).
