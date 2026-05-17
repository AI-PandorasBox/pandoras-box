# core -- Requirements

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| macOS | 14.0 (Sonoma) | Latest available |
| Node.js | 20.x | Latest LTS |
| RAM | 4 GB | 8 GB (16 GB for ollama module) |
| Disk | 10 GB free | 50 GB free |
| Homebrew | Any recent | Latest |

## Required Software

```
brew install node
```

## Required Credentials

| Credential | Where to get it | Notes |
|-----------|----------------|-------|
| Anthropic API key | console.anthropic.com | Starts with `sk-ant-` |

## Permissions

- Administrator (sudo) access required during installation
- Service accounts are created as macOS users with UID >= 500
- `/opt/pandoras-box/` created as root, subdirectories owned by service accounts
- `/var/ai-jobs/` created with appropriate permissions for shared job queue access

## API Permissions

- Anthropic: standard API access (no special scopes required)
