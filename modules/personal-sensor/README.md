# personal-sensor

**Status:** Optional
**Depends on:** core (theme.conf). Consumes data from `mail-ms365` and/or `mail-google` if installed.

## What It Does

`personal-sensor` is the ambient signal layer for Pandoras Box. It runs as a
resident LaunchDaemon, scans configured signal sources every 10 minutes, and
fans the resulting events out over a localhost Server-Sent Events stream.
Other modules (notably `personal-ai`) subscribe to that stream and decide
whether any given event is worth surfacing to the operator.

The daemon itself makes no LLM calls and takes no actions. It senses; the
consumer decides.

### Signal sources

Each source is independent. If its prerequisites are missing the daemon emits
a single `*_unavailable` event per scan and moves on.

| Source | What it produces | Prerequisite |
|---|---|---|
| Calendar (MS Graph) | `calendar_event_upcoming`, `calendar_event_starting_soon`, `free_time_gap` | `mail-ms365/.env` with a `*_TOKEN` entry |
| Calendar (Google) | same kinds | `mail-google/.env` with a `*_TOKEN` entry |
| Geofence | `geofence_entered`, `geofence_left` | `PERSONAL_SENSOR_GEOFENCE=1` and `brew install corelocationcli` |

### Event shape

```json
{
  "ts": "2026-01-01T12:34:56.000Z",
  "id": "<uuid>",
  "kind": "calendar_event_starting_soon",
  "source": "calendar:ms365",
  "payload": { "id": "...", "title": "...", "start": "...", "end": "...", "minutes_to_start": 12 }
}
```

`kind` is one of: `calendar_event_upcoming`, `calendar_event_starting_soon`,
`free_time_gap`, `geofence_entered`, `geofence_left`, `calendar_unavailable`,
`geofence_unavailable`.

## Endpoints

All bound to `127.0.0.1`. No write paths exist.

| Path | Purpose |
|---|---|
| `GET /events` | Persistent SSE stream. New events arrive as `data: {...}\n\n` lines. |
| `GET /recent?n=50` | Last N events from the persistent log (max 500). |
| `GET /health` | `{ ok, clients, scan_in_flight, scan_interval_ms }`. |

Remote access is intentionally not supported. Operators who need to reach the
stream from another device should reverse-proxy via Tailscale.

## Environment variables

Read from `$INSTALL_PATH/personal-sensor/.env` (written by `install.sh`):

| Var | Default | Purpose |
|---|---|---|
| `PERSONAL_SENSOR_SSE_PORT` | `8489` | Port the SSE server listens on. |
| `PERSONAL_SENSOR_SCAN_MS` | `600000` | Scan cadence in milliseconds (10 min). |
| `PERSONAL_SENSOR_GEOFENCE` | `0` | Set to `1` to enable geofence scanning. |
| `INSTALL_PATH` | `/opt/pandoras-box` | Install root, supplied by `theme.conf`. |

### Token sourcing (important)

`personal-sensor` does **not** store calendar tokens of its own. It reads them
at scan time from the existing `mail-ms365/.env` or `mail-google/.env` files
written by those modules. If neither file exists, or neither contains a
`*_TOKEN` entry, the daemon emits `calendar_unavailable` and continues with
other signal sources. Token rotation is the responsibility of the mail
modules, not this one.

## Files written

| Path | Purpose |
|---|---|
| `$INSTALL_PATH/personal-sensor/pbox-personal-sensor.mjs` | Runtime. |
| `$INSTALL_PATH/personal-sensor/.env` | Operator config (mode 600). |
| `$INSTALL_PATH/personal-sensor/store/events.jsonl` | Persistent event log, one JSON object per line. |
| `$INSTALL_PATH/personal-sensor/store/events.1.jsonl` | Rotated previous log (when the live log hits 10 MB). |
| `$INSTALL_PATH/personal-sensor/places.json` | Optional list of named lat/lon places for geofencing. |

`places.json` format (operator-provided, optional):

```json
[
  { "name": "home", "lat": 51.5074, "lon": -0.1278, "radius_m": 150 },
  { "name": "office", "lat": 51.5155, "lon": -0.0922, "radius_m": 200 }
]
```

## Installation

```bash
sudo bash modules/personal-sensor/install.sh
```

The installer:

1. Confirms Node 22 is on `$PATH`.
2. Stages the runtime under `$INSTALL_PATH/personal-sensor/`.
3. Writes the `.env` (prompts once for geofence opt-in).
4. Renders the plist template and registers the LaunchDaemon.
5. Curls `/health` to confirm the service bound.

Dry-run: set `PBOX_DRY_RUN_ACTIVE=1`. The installer will render and lint the
plist but skip `launchctl load`.

## Verifying

```bash
# Stream live events
curl -N http://127.0.0.1:8489/events

# Last 20 persisted events
curl -s 'http://127.0.0.1:8489/recent?n=20' | jq .

# Health
curl -s http://127.0.0.1:8489/health | jq .
```

## Troubleshooting

**`calendar_unavailable` events every scan**
Either `mail-ms365` and `mail-google` are both uninstalled, or neither
`.env` contains a `*_TOKEN` entry. Install one of the mail modules and
re-authenticate; this daemon will pick up the token on the next scan with no
restart needed.

**`geofence_unavailable` with reason `corelocationcli_missing`**
Install the helper: `brew install corelocationcli`, then `sudo launchctl
unload/load` the plist. macOS will prompt for Location Services permission on
first run.

**Service registered in `launchctl list` but `/health` does not respond**
Check `tail -50 /tmp/$LOG_PREFIX-personal-sensor.log` for the bind error.
Most commonly a port conflict on `PERSONAL_SENSOR_SSE_PORT`.

## Uninstall

```bash
sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.personal-sensor.plist
sudo rm /Library/LaunchDaemons/com.pandoras-box.personal-sensor.plist
sudo rm -rf /opt/pandoras-box/personal-sensor
```
