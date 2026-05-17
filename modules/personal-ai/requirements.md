# personal-ai -- Requirements

## System Requirements

| Requirement | Value |
|-------------|-------|
| core module | Required |
| Tailscale | Recommended (required for remote access) |
| TLS certificate | Required for HTTPS |

## API Credentials

| Credential | Required for |
|-----------|-------------|
| Anthropic API key | All AI responses (inherited from core .env) |

## Network

- Listens on port 8800 (configurable)
- Tailscale provides remote access
- TLS certificate required for browser HTTPS

## Permissions

- Runs as the personal-AI service account
- Reads from `/opt/pandoras-box/muse/` (750)
- Writes to `/opt/pandoras-box/muse/store/` for conversation history
