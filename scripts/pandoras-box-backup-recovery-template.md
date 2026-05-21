# Pandoras Box -- Backup Recovery

This file is intentionally plaintext (not encrypted) so a future-you with no
working Pandoras Box install can still find the recovery instructions. The
encrypted backup blobs sit alongside this file in `/Users/Shared/pandoras-box-backups/`.

## What you need to recover

1. The encrypted backup blob: `<DATE>.tar.age` (or `latest` -> blob symlink) in `/Users/Shared/pandoras-box-backups/`.
2. The age private key, in one of these places:
   - macOS Keychain item `pbox-backup-age` (the user who installed)
   - Off-box copy you made during install (USB stick, paper, password manager)
   - Desktop file `PBOX-BACKUP-PRIVKEY-DELETE-AFTER-COPYING.txt` if you saved it there

## Recovery commands

### 1. Get the private key

```bash
# From Keychain (if this Mac still works):
security find-generic-password -s "pbox-backup-age" -w > ~/key.txt
chmod 600 ~/key.txt

# Or paste your off-box copy into ~/key.txt with a text editor.
```

### 2. Decrypt the most recent blob

```bash
sudo age -d -i ~/key.txt < /Users/Shared/pandoras-box-backups/latest | tar -xf -
```

The decrypted contents land in a dated subdirectory of your current working
directory. Read `MANIFEST.txt` first -- it lists every component, its size,
and its status.

### 3. Restore individual components

The tarball typically contains:

| Subdir | Contents |
|---|---|
| `install/install-DATE.tar.gz` | Full `/opt/pandoras-box/` (or your `$INSTALL_PATH`), excluding `node_modules`, `.env` files, and `secrets/` |
| `sqlite/` | `.backup`-consistent SQLite copies (one file per database under `$INSTALL_PATH`) |
| `postgres/` | `pg_dump -Fc` files (one per database, only if `PG_DBS` was configured) |
| `desktop/` | `~/Desktop` tarball (only if `BACKUP_DESKTOP=yes` was configured) |
| `documents/` | `~/Documents` tarball (only if `BACKUP_DOCUMENTS=yes` was configured) |
| `MANIFEST.txt` | Per-component byte counts + status -- start here |

Per-database restore commands:

```bash
# SQLite
cp sqlite/<name>-DATE.db /opt/pandoras-box/.../store/<name>.db
chown <owner>:<group> /opt/pandoras-box/.../store/<name>.db
chmod 644 /opt/pandoras-box/.../store/<name>.db

# Postgres custom-format dump
pg_restore -d <dbname> --clean --if-exists < postgres/<db>-DATE.dump
```

## Disaster recovery (this Mac is gone)

1. Get hold of any Mac with Tahoe 14 or newer.
2. Install Homebrew + age: `brew install age`
3. Copy your off-box `key.txt` to the new Mac.
4. Pull the most recent blob from your offsite tier (B2 if configured) -- or
   from a manual backup if not.
5. Decrypt + extract as above.
6. Reinstall Pandoras Box on the new Mac: `bash <(curl -fsSL https://raw.githubusercontent.com/AI-PandorasBox/pandoras-box/main/install.sh)`
7. Stop the new install's services, restore the relevant pieces, restart.

If you do not have an off-box private-key copy and this Mac is gone, the
backups are **unrecoverable**. Make an off-box copy now if you haven't.

## How to test recovery without committing

Decrypt the most recent blob into `/tmp/`:

```bash
mkdir -p /tmp/pbox-recovery-test
cd /tmp/pbox-recovery-test
sudo age -d -i ~/key.txt < /Users/Shared/pandoras-box-backups/latest | tar -xf -
ls -la
cat */MANIFEST.txt
```

Inspect the manifest. Confirm components have non-trivial byte counts. Then
clean up: `sudo rm -rf /tmp/pbox-recovery-test`.

## Daily email report

If you configured SMTP creds during install, you get an `[OK]` or `[FAIL]` email
each morning at 07:00. `[FAIL]` means one or more components came back empty
last night; `latest` is NOT updated until a clean run completes. Investigate
the next morning rather than the same night.

If you didn't configure SMTP, the daemon runs silently. Inspect manually:

```bash
tail /tmp/pandoras-box-backup-daemon.log
ls -la /Users/Shared/pandoras-box-backups/
```

`latest` should point at a recent dated blob, > 100 MB.
