# personal-sensor -- Requirements

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| macOS | 13 (Ventura) | 14+ |
| Node.js | 22.x | 22.x |
| Pandoras Box core | installed (`theme.conf` present) | -- |
| `mail-ms365` and/or `mail-google` | optional; calendar signals require at least one | -- |
| `corelocationcli` (Homebrew) | optional; geofencing requires it | `brew install corelocationcli` |

## Ports

| Port | Bind | Direction | Purpose |
|---|---|---|---|
| `PERSONAL_SENSOR_SSE_PORT` (default `8489`) | `127.0.0.1` | Inbound, localhost-only | SSE stream + `/health` + `/recent`. No remote access. Use Tailscale to reverse-proxy if off-box reach is required. |

No outbound ports are opened by this module beyond standard HTTPS (443) to
Microsoft Graph and Google Calendar, and only when a calendar token is
present.

## Environment Variables

Read from `$INSTALL_PATH/personal-sensor/.env`:

| Var | Default | Required | Notes |
|---|---|---|---|
| `PERSONAL_SENSOR_SSE_PORT` | `8489` | no | TCP port. |
| `PERSONAL_SENSOR_SCAN_MS` | `600000` | no | Scan cadence, milliseconds. |
| `PERSONAL_SENSOR_GEOFENCE` | `0` | no | `1` to enable geofence scanning. |
| `INSTALL_PATH` | `/opt/pandoras-box` | yes | Supplied by `theme.conf`. |

## Required Credentials

None stored by this module.

Calendar tokens are read at scan time from the existing mail-module `.env`
files (`mail-ms365/.env` or `mail-google/.env`). The daemon looks for any
variable matching `*_TOKEN`, `*_ACCESS_TOKEN`, or `*_REFRESH_TOKEN` and uses
the first one it finds as a bearer token against the relevant Graph or
Google Calendar REST endpoint. Token rotation is the responsibility of the
mail modules.

## Permissions

- Runs as the service-account user owning `$INSTALL_PATH` (typically the
  Pandoras Box admin user) -- same convention as `dashboard` and `terminal`.
- Reads (no writes):
  - `$INSTALL_PATH/mail-ms365/.env`
  - `$INSTALL_PATH/mail-google/.env`
  - `$INSTALL_PATH/personal-sensor/places.json`
- Writes:
  - `$INSTALL_PATH/personal-sensor/store/events.jsonl` (mode 644, owned by service user)
  - `$INSTALL_PATH/personal-sensor/store/events.1.jsonl` (rotated)
- Geofencing path additionally invokes `corelocationcli -once` via
  `child_process.execFile` (no shell, array args only). macOS will prompt
  for Location Services consent on first invocation.

## API / Network Surface

- **Outbound:** `https://graph.microsoft.com/v1.0/me/calendarView` and
  `https://www.googleapis.com/calendar/v3/calendars/primary/events`. Both
  gated on a token being present in the relevant mail module's `.env`.
- **Inbound:** localhost only, read-only. No POST/PUT/DELETE handlers are
  defined.

## Security model

- `child_process.execFile` only, with array-form arguments. Shell-style
  invocation is not used anywhere in the runtime.
- `127.0.0.1` bind, no listening interface on any other address.
- Token-shaped strings never appear in the persistent log; only event
  payloads do.
- `PBOX_DRY_RUN_ACTIVE=1` makes the installer a complete no-op for
  `launchctl load` and live API calls.
