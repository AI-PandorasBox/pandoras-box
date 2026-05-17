# offline-kb

**Status:** Optional
**Depends on:** Docker, Node 22+
**Storage:** Local. All ZIM files live on disk; no network egress at query time.

## What It Does

Runs a local [Kiwix](https://kiwix.org) server in Docker against an offline ZIM
pack (Wikipedia, Wiktionary, Stack Overflow), with a thin Node wrapper that
provides a branded landing page, a JSON search API, and a search log.

Two endpoints to know:

- `http://127.0.0.1:8090/` -- the branded UI (search box + recent queries)
- `http://127.0.0.1:8090/api/search?q=<query>` -- JSON results, also writes
  the query to the local SQLite log

## ZIM Choices

You pick one during install. All are free from
[download.kiwix.org/zim](https://download.kiwix.org/zim).

| Pack | Size | Notes |
|---|---|---|
| `wikipedia_en_simple_all_nopic` | ~1.5 GB | **Default.** Simple English Wikipedia, no images. Good starting point. |
| `wikipedia_en_all_nopic` | ~13 GB | Full English Wikipedia, text-only. |
| `wikipedia_en_all` | ~95 GB | Full English Wikipedia, with images. |
| `wiktionary_en_all_nopic` | ~1 GB | Dictionary. |
| `stackoverflow.com_en_all` | ~80 GB | Programming Q&A. |
| `skip` | -- | Don't download anything; you provide a ZIM in `$INSTALL_PATH/offline-kb/zim/` manually. |

**Disk-space warning.** The 95 GB and 80 GB packs will eat real disk. Verify
you have headroom before selecting them. There is no resume on partial
download (the installer uses `curl --fail` and discards `.part` files on
interrupt).

## Add More Packs After Install

Drop additional `.zim` files into `$INSTALL_PATH/offline-kb/zim/` and restart
the container:

```bash
cd /opt/pandoras-box/offline-kb && docker compose restart
```

Kiwix auto-discovers every `.zim` in the mounted directory.

## Remote Access

Wrapper binds `127.0.0.1` by default. For LAN or off-box use, **do not** flip
the bind to `0.0.0.0` -- there is no auth layer. Front it with Tailscale:

```bash
# On the machine running the module:
tailscale serve --bg --https=443 / http://127.0.0.1:8090
```

Or any reverse proxy that provides authentication.

## Privacy

The search log lives at `$INSTALL_PATH/offline-kb/store/searches.db`, owned by
the operator. It is never read by the network and never exported. Delete the
file to clear history.

## Troubleshooting

| Symptom | Check |
|---|---|
| HTTP 502 from /api/search | Container not running: `docker ps \| grep kiwix` |
| HTTP 200 but zero results | ZIM not loaded: `docker logs pbox-kiwix \| tail` |
| Wrapper not listening | LaunchDaemon log: `tail -50 /tmp/pandoras-box-offline-kb.log` |
| Port collision on 8090 | Override with `OFFLINE_KB_PORT` in `$INSTALL_PATH/offline-kb/.env`, reload the daemon |

## Uninstall

```bash
launchctl unload /Library/LaunchDaemons/com.pandoras-box.offline-kb.plist
sudo rm /Library/LaunchDaemons/com.pandoras-box.offline-kb.plist
cd /opt/pandoras-box/offline-kb && docker compose down
sudo rm -rf /opt/pandoras-box/offline-kb
```

This frees the disk space the ZIMs were using.
