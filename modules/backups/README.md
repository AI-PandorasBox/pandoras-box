# backups

**Status:** Recommended
**Depends on:** core
**Default at install:** Yes

## What It Does

Encrypted, offsite-ready backups of your Pandoras Box state. Every night at
03:30, a single age-encrypted tarball is produced containing:

- Postgres CRM database dumps (whichever local DBs are present)
- SQLite copies of agent memory, knowledge stores, and any module-local data
- Personal Assistant tarball (vault + chat history + memory.db)
- Configuration tarball (`/opt/pandoras-box/` minus large caches)
- A plaintext MANIFEST.txt listing every file + size + timestamp

The plaintext run is deleted after the encrypted blob is verified non-trivial
size. A separate Sunday job (07:30) verifies the most recent backup is fresh
and readable, and writes a status JSON the dashboard surfaces.

## Why encrypted

The backup tarball contains everything an attacker would want: API keys (in
config files), email content, contact graphs, journal entries from your
Obsidian vault if you connected one. Storing it in plaintext in
`/Users/Shared/` would defeat the purpose.

The encryption key is generated during install. The private key is stored in
your macOS Keychain (item: `pbox-backup-age`). You are offered (and strongly
encouraged) to make at least one off-box copy: USB stick, paper, password
manager. If this Mac is lost or its disk fails and you have no off-box copy,
the backups are unrecoverable.

A plaintext `RECOVERY.md` is written outside the encrypted blob (alongside it,
on the same volume). This is intentional. Future-you, on a fresh OS install
with no working Pandoras Box, will be able to find the recovery instructions.

## Requirements

- `core` module installed
- Homebrew (for installing `age`)
- Free disk space for backup volume (default `/Users/Shared/` -- 1-5 GB
  depending on what data has accumulated)

## Monthly Cost

Free. The backup volume is local. No cloud charges. Off-box copy is optional
and uses your own storage.

## Configuration

Edit `/opt/pandoras-box/backups/.env` to change:
- `PBOX_BACKUP_VOL` -- destination directory (default: `/Users/Shared/pandoras-box-backups`)
- `PBOX_BACKUP_RETAIN_DAYS` -- how many days of blobs to keep (default: 30)
- `PBOX_BACKUP_HOUR` / `PBOX_BACKUP_MINUTE` -- daily run time (default: 03:30)

After editing, restart the LaunchAgents:
```
launchctl stop com.pandoras-box.backup && launchctl start com.pandoras-box.backup
```

## Recovery

See `<your backup volume>/RECOVERY.md`. The short version:

```bash
# 1. Get the private key out of Keychain
security find-generic-password -s "pbox-backup-age" -w > ~/key.txt

# 2. Decrypt the most recent blob
age -d -i ~/key.txt < /Users/Shared/pandoras-box-backups/$(date +%F).tar.age | tar -xf -

# 3. Restore from extracted files (paths in MANIFEST.txt)
```

## Off-box copy options

The installer offers three paths during setup:

1. Print to terminal (you copy by hand to a separate device or password manager)
2. Save to a Desktop file `PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt` --
   you move this off the Mac, then delete the Desktop file
3. Skip for now (you can do this any time later via
   `security find-generic-password -s "pbox-backup-age" -w`)

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.pandoras-box.backup.plist
launchctl unload ~/Library/LaunchAgents/com.pandoras-box.backup-freshness.plist
rm ~/Library/LaunchAgents/com.pandoras-box.backup*.plist
```

This stops new backups. It does not delete existing encrypted blobs or the age
keypair.
