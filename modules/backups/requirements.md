# backups -- Requirements

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Disk space (backup vol) | 5 GB free | 50 GB free (30 days retention) |
| Homebrew | Yes (installer auto-uses) | -- |
| `age` | Auto-installed via Homebrew | -- |

## Required Software

```
brew install age
```

(The installer runs this automatically. You should not need to do it manually.)

## Required Credentials

| Credential | Where it lives | Notes |
|-----------|----------------|-------|
| age keypair | Generated during install | Public key on disk; private key in macOS Keychain (`pbox-backup-age`) |

## Permissions

- Daily backup LaunchAgent runs as your admin user (read access to the
  Personal Assistant's store + per-company stores via the shared
  `pandoras-box` group).
- Backup volume default `/Users/Shared/pandoras-box-backups/` -- group-writable.

## API Permissions

None. Backup is fully local.
