# macOS iCloud Drive — disable Desktop & Documents sync before install

**One-line summary:** Pandora's Box installs into `~/Desktop` and `/opt/pandorasbox`. If iCloud Drive's "Desktop & Documents Folders" feature is enabled, macOS may evict your installed files to iCloud and replace them with placeholder stubs — silently breaking every service that imports them.

This is the single most important pre-install setting on macOS. Do it before you run `pbox-setup.sh`.

## What goes wrong if you skip this

macOS's "Optimize Mac Storage" feature is paired with iCloud Drive's Desktop & Documents folder sync. When local disk pressure rises, macOS evicts older files to iCloud and leaves only metadata behind. On disk the file looks the right size and date — but its content lives in iCloud only. macOS calls these files **dataless**:

```
$ ls -lO ~/Desktop/ZEUS/scripts/zeus-lite-server.mjs
-rwxr-xr-x  qwerty  staff  compressed,dataless  115077  ...
```

Node.js (and other servers) hit `EAGAIN` when their `readFileSync` calls try to materialise a dataless file from a background context. The service exits with code 1, no stack trace, no useful log line:

```
Error: Unknown system error -11: Unknown system error -11, read
    at Object.readSync (node:fs:736)
    at readFileSync (node:fs:462)
```

You also lose backup integrity. Anything backed up by `tar` while the file is dataless captures a placeholder, not the content. A 200 MB script ends up as a 0-byte entry in your archive. The metadata says "backup succeeded" — the data is gone.

In a multi-agent system where conductors, task agents, and the oversight daemon all read from disk at startup, you can lose dozens of services in one storage-eviction event and have no obvious cause to chase.

## How to disable it

1. Open **System Settings** (Apple menu → System Settings…).
2. Click your name at the top → **iCloud**.
3. Open **iCloud Drive** → **Options**.
4. **Uncheck "Desktop & Documents Folders"**. macOS will ask whether to keep local copies — choose **Keep a Local Copy**, not "Remove from this Mac".
5. Back on the iCloud screen, **turn off "Optimize Mac Storage"** as well. With this on, even non-Desktop iCloud-synced files can become dataless.

## Verify

Run this against any directory you plan to install into:

```bash
find /path/to/install/target -type f -flags +dataless 2>/dev/null | wc -l
```

The count must be `0`. If it isn't, your existing files are already dataless. To force re-download:

```bash
# Materialise everything dataless by reading each file
find /path/to/install/target -type f -flags +dataless -exec cat {} + > /dev/null
```

This pulls each file from iCloud back to local disk. Files can be large; expect 1–2 seconds per file on residential connections.

## Why Pandora's Box is especially exposed

- It installs ~50 LaunchDaemons and LaunchAgents, every one of which does synchronous module loading at startup.
- Some of these run as macOS service accounts (`mnemosyne`, `argus`, per-company users). LaunchDaemon context cannot complete an on-demand iCloud download — it gets `EAGAIN` and the service exits.
- The `/opt/pandorasbox` tree is not under iCloud control, but `~/Desktop/ZEUS` (the admin/Zeus tree) is — and that's where deploy scripts, dashboard servers, and the docs site live.
- Backups (tar + age + B2) silently capture placeholders if any file is dataless at the time of capture.

## If you've already hit this

1. Stop. Don't restart services repeatedly — each restart is a chance for the OS to silently re-evict.
2. Disable Desktop & Documents folder sync and Optimize Mac Storage as above.
3. Materialise everything: `find ~/Desktop ~/Documents /opt/pandorasbox -type f -flags +dataless -exec cat {} + > /dev/null`
4. Verify dataless count is 0.
5. Take a fresh backup. The previous backups in B2 / Time Machine while the eviction was active are likely corrupted — treat any backup taken during the affected window as suspect.

## Related

- macOS uses the same dataless mechanism for `File Provider` extensions (Dropbox, OneDrive, Google Drive). The same advice applies: do not install Pandora's Box into a directory managed by any cloud sync client.
- Time Machine to a network destination (NAS) over SMB has known reliability issues on macOS 14+. A USB-attached Time Machine target is more reliable.
