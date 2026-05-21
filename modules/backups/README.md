# backups

**Status:** Recommended
**Depends on:** core
**Default at install:** Yes
**Requires sudo:** Yes (LaunchDaemon install)

## What It Does

Encrypted, offsite-ready backups of your Pandoras Box state. Every night at
03:30, a root LaunchDaemon produces a single age-encrypted tarball containing:

- Postgres CRM database dumps (whichever local DBs are configured)
- SQLite copies of agent memory, knowledge stores, and any module-local data
  (online `.backup` for write-consistency)
- Full `$INSTALL_PATH` tarball (default `/opt/pandoras-box/`), excluding
  `node_modules`, `.env` files, and `secrets/`
- Optionally `~/Desktop` and `~/Documents` (opt-in; requires Full Disk Access)
- A plaintext `MANIFEST.txt` listing every component, byte count, and status

**Per-component size assertion.** If any component comes back empty, `FATAL_REASON`
is set and the `latest` symlink is NOT updated. This is the fix for the silent
"backup ran but produced zero bytes" failure mode that we hit on macOS Tahoe
before this architecture.

The plaintext run dir is rolled up into a single tarball, age-encrypted, and
the plaintext copy is removed after the first successful run.

## Why root LaunchDaemon (and not a user LaunchAgent)

macOS Tahoe's TCC silently blocks user LaunchAgents from reading `~/Desktop`
and `~/Documents`. A root LaunchDaemon with explicit Full Disk Access for
`/bin/bash` can read everything. The installer walks you through granting FDA
before the first scheduled run.

## Why encrypted

The backup tarball contains everything an attacker would want: API keys (in
config files), email content, contact graphs, journal entries from your
Obsidian vault if you connected one. Storing it in plaintext under
`/Users/Shared/` would defeat the purpose.

The encryption key is generated during install. The private key is stored in
your macOS Keychain (item `pbox-backup-age`). You are offered (and strongly
encouraged) to make at least one off-box copy: USB stick, paper, password
manager. If this Mac is lost or its disk fails and you have no off-box copy,
the backups are unrecoverable.

A plaintext `RECOVERY.md` is written alongside the encrypted blob (on the same
volume). This is intentional. Future-you, on a fresh OS install with no working
Pandoras Box, will be able to find the recovery instructions even without
unlocking anything.

## Requirements

- `core` module installed
- Homebrew (the installer auto-uses it to install `age`)
- Sudo password (for LaunchDaemon install + writes to `/Library/LaunchDaemons/`,
  `/Users/Shared/`, `/usr/local/etc/`)
- ~5 GB free disk on the backup volume (60 day retention)
- Full Disk Access grant for `/bin/bash` (the installer walks you through it)

## Optional add-ons

| Feature | Opt-in during install | Notes |
|---|---|---|
| B2 offsite mirror | Yes/no prompt | Weekly upload to Backblaze B2. ~\$0.005/GB/month. 14-day remote retention. |
| Daily [OK]/[FAIL] email | Yes/no prompt | SMTP relay (use Gmail App Password, Mailgun, or your own). Subject prefix + per-component body. |
| Backup Desktop folder | env var `BACKUP_DESKTOP=yes` | TCC-sensitive. Confirm FDA granted. |
| Backup Documents folder | env var `BACKUP_DOCUMENTS=yes` | Same. |
| Postgres DBs | env var `PG_DBS="db1:user1:pass1 db2:user2:pass2"` | Sets up `pg_dump -Fc` for each space-separated spec. |

## File layout

| Path | Owner | Mode | Purpose |
|---|---|---|---|
| `/Library/LaunchDaemons/com.pandoras-box.backup.plist` | root:wheel | 644 | Daily 03:30 |
| `/Library/LaunchDaemons/com.pandoras-box.backup-offsite.plist` | root:wheel | 644 | Sunday 01:00 (only if B2 configured) |
| `~/Library/LaunchAgents/com.pandoras-box.backup-daily-report.plist` | you:staff | 644 | 07:00 daily email (only if SMTP configured) |
| `/Users/Shared/pandoras-box-backup-scripts/` | root:wheel | 755 | Backup scripts + recovery template |
| `/usr/local/etc/pandoras-box-backup.env` | root:wheel | 600 | Creds + config (B2, SMTP, retention) |
| `/usr/local/etc/pandoras-box-backup-pubkey.txt` | root:wheel | 644 | Age recipient public key |
| `/Users/Shared/pandoras-box-backups/<DATE>.tar.age` | root:wheel | 644 | Encrypted blob (one per day) |
| `/Users/Shared/pandoras-box-backups/latest` | root:wheel | symlink | Always points at the most recent healthy blob |
| `/Users/Shared/pandoras-box-backups/RECOVERY.md` | root:wheel | 644 | Plaintext recovery instructions |
| `/tmp/pandoras-box-backup-daemon.log` | root:wheel | 600 | Daemon stdout/stderr |

## Configuration

Edit `/usr/local/etc/pandoras-box-backup.env` (sudo required):

```env
AGE_PUBKEY_FILE="/usr/local/etc/pandoras-box-backup-pubkey.txt"
BACKUP_VOL="/Users/Shared/pandoras-box-backups"
KEEP_DAYS=60
MIN_BLOB_SIZE_BYTES=104857600   # 100 MB -- below this, `latest` is not updated

# B2 offsite (optional)
B2_KEYID="..."
B2_APPKEY="..."
B2_BUCKET="pandoras-box-backups"
B2_RETENTION_DAYS=14

# SMTP daily report (optional)
SMTP_HOST="smtp.example.com"
SMTP_USER="..."
SMTP_PASS="..."
REPORT_EMAIL_TO="you@example.com"
```

After editing, no restart is needed -- the daemon reads the env file on every run.

## Run manually

```bash
sudo launchctl kickstart -k system/com.pandoras-box.backup
tail -f /tmp/pandoras-box-backup-daemon.log
```

## Recovery

See `/Users/Shared/pandoras-box-backups/RECOVERY.md`. Short version:

```bash
# 1. Get the private key
security find-generic-password -s "pbox-backup-age" -w > ~/key.txt

# 2. Decrypt the most recent blob
sudo age -d -i ~/key.txt < /Users/Shared/pandoras-box-backups/latest | tar -xf -

# 3. Inspect MANIFEST.txt and restore individual components
```

## Off-box copy options

The installer offers two paths:

1. Print to terminal (you copy by hand to a separate device or password manager)
2. Skip for now (re-run any time later: `security find-generic-password -s "pbox-backup-age" -w`)

If you skipped, **do it now** if you haven't already. Without an off-box key
copy, a lost or stolen Mac means lost backups.

## Uninstall

```bash
sudo launchctl bootout system/com.pandoras-box.backup
sudo launchctl bootout system/com.pandoras-box.backup-offsite 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.pandoras-box.backup-daily-report.plist 2>/dev/null || true
sudo rm -f /Library/LaunchDaemons/com.pandoras-box.backup*.plist
rm -f ~/Library/LaunchAgents/com.pandoras-box.backup-daily-report.plist
sudo rm -rf /Users/Shared/pandoras-box-backup-scripts
sudo rm -f /usr/local/etc/pandoras-box-backup.env
# Leaves the encrypted blobs intact. Remove them manually if you want.
```
