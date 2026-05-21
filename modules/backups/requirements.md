# backups -- Requirements

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| macOS | 14 (Sonoma) | 14.5+ |
| Disk space (backup vol) | 5 GB free | 50 GB free (60 day retention) |
| Homebrew | Yes | -- |
| `age` | Auto-installed via Homebrew | -- |
| `sqlite3` | Provided by macOS at `/usr/bin/sqlite3` | -- |
| `rclone` (for B2) | `brew install rclone` | -- |
| Node 22+ (for daily-report email) | Already a Pandoras Box core requirement | -- |

## Required Software

```
brew install age sqlite      # core
brew install rclone          # only if you opt in to B2 offsite
```

## Required Privileges

| Step | Privilege |
|---|---|
| LaunchDaemon install | `sudo` (writes to `/Library/LaunchDaemons/`) |
| Script install | `sudo` (writes to `/Users/Shared/pandoras-box-backup-scripts/`, root:wheel) |
| Env file write | `sudo` (writes to `/usr/local/etc/pandoras-box-backup.env`, root:wheel 600) |
| Daily-report LaunchAgent (optional) | user (writes to `~/Library/LaunchAgents/`) |
| FDA grant for `/bin/bash` | manual user step in System Settings (TCC requires UI interaction) |

## Required Credentials

| Credential | Where it lives | Notes |
|---|---|---|
| age keypair | Generated during install | Public key at `/usr/local/etc/pandoras-box-backup-pubkey.txt` (root:wheel 644). Private key in macOS Keychain (`pbox-backup-age`). |
| Backblaze B2 KeyID + AppKey | Prompted during install (optional) | Written to `/usr/local/etc/pandoras-box-backup.env`. Used only by the weekly offsite daemon. |
| SMTP credentials | Prompted during install (optional) | Same env file. Used only by the daily-report LaunchAgent. |
| Postgres password(s) | Env-file edit (manual, optional) | Set `PG_DBS="db1:user:pass db2:user:pass"`. Mirrored into the env file so the root daemon does not need to read your `~/.pgpass`. |

## Permissions

- Daily backup LaunchDaemon runs as `root`. This is the change vs the previous
  installer, where a user LaunchAgent silently TCC-failed on `~/Desktop` and
  `~/Documents`.
- Encrypted blobs end up at `/Users/Shared/pandoras-box-backups/<DATE>.tar.age`
  with root:wheel ownership. Recovery requires sudo.
- The daily-report LaunchAgent stays in user context (no SIP/TCC barriers for
  outbound SMTP).

## TCC Caveat

macOS Tahoe blocks root daemons from reading user `~/Desktop` and `~/Documents`
unless `/bin/bash` (or a parent in the exec chain) has Full Disk Access. The
installer prompts you to grant FDA, opens the Privacy & Security pane, and
asks you to confirm. If you skip, your first backup's Desktop + Documents
components will come back empty; the per-component size assertion will catch
this and the morning email will report `[FAIL]`.

## API Permissions

None for the local backup itself. The optional B2 mirror talks to
`api.backblazeb2.com:443`. The optional daily-report email talks to whichever
SMTP server you configure. No other outbound calls.

## Monthly Cost

- Local-only: free.
- B2 offsite (optional): ~\$0.005/GB/month for storage. A typical Pandoras Box
  install produces 100-500 MB encrypted/day; with 14-day remote retention the
  ongoing cost is well under \$0.05/month.
- SMTP (optional): depends on your provider. Gmail with an App Password is free
  for low volume.
