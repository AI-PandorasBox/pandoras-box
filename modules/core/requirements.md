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
| Claude Pro or Max subscription | claude.ai | Signed in via `claude /login` (browser). API-key billing is not supported in this release. |

## Permissions

- Administrator (sudo) access required during installation
- Service accounts are created as macOS users with UID >= 500
- `/opt/pandoras-box/` created as root, subdirectories owned by service accounts
- `/var/ai-jobs/` created with appropriate permissions for shared job queue access

## Claude access

- Authenticated via your Claude Pro or Max subscription (`claude /login`). No API key required.
