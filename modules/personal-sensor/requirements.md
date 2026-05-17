# personal-sensor -- Requirements

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| `personal-ai` module | Required | -- |
| Phone | Required for watch path | Recent iOS / Android |
| Watch (optional) | -- | Pixel Watch 4, Galaxy Watch 6+, Apple Watch S6+ |
| Tailscale on phone | Required for watch path | -- |

## Required Software

Auto-installed by the install step.

## Required Credentials

| Credential | Where to provide it | Notes |
|-----------|---------------------|-------|
| Geofencing addresses | During install | Strings; geocoded on first daemon start |
| Google Fit / Apple Health permission | On the phone | First-run prompt from the phone app |

## Permissions

- the Personal Sensor Layer daemon runs as the Personal Assistant's service-account user
- Reads the Personal Assistant's chat history + calendar caches
- Writes signal state to `/opt/pandoras-box/personal-sensor/state.json` (mode 660)
- Phone-side: Tailscale required for relay; health permissions optional

## API Permissions

No external APIs. All sensing is local + phone-relayed.
