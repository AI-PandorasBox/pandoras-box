# Setup — Docker (for the Offline Knowledge Library offline knowledge)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

Docker is required only for the **the Offline Knowledge Library** module, which hosts offline knowledge bases (Wikipedia, reference works) via Kiwix. If you're not installing the Offline Knowledge Library, you don't need Docker.

## Prerequisites

- Docker Desktop installed.
- ~50 GB free disk for the Wikipedia ZIM file (more if you want additional Kiwix archives).

## Setup steps

### 1. Install Docker Desktop

```
brew install --cask docker
```

Or download from https://docker.com/products/docker-desktop.

Open Docker Desktop after install. Accept the licence prompt. The Docker daemon starts.

### 2. Sign in to Docker Hub (optional)

Not strictly required — Kiwix images are public. But signing in raises your pull rate limit, which matters if you're rebuilding the container often.

### 3. The Pandora's Box installer handles the rest

When you reach the the Offline Knowledge Library step:

- The installer downloads the latest Wikipedia ZIM (~30 GB) to `/opt/pandoras-box/offline-kb/zim/`.
- Pulls the `kiwix/kiwix-serve` Docker image.
- Starts the container exposing Kiwix on `http://127.0.0.1:8086`.
- Registers a LaunchDaemon (`com.pandoras-box.offline-kb-kiwix`) that auto-starts the container at boot.

## Verifying it works

After the installer finishes the the Offline Knowledge Library step:

```
curl -s http://127.0.0.1:8086/ROOT/search?pattern=Plato | head -20
```

You should see HTML search results. Or visit `http://127.0.0.1:8086/` in your browser for the Kiwix UI.

Ask your Personal AI:

```
offline-kb: who was Plato
```

The agent queries Kiwix and answers from the offline Wikipedia.

## Adding more Kiwix archives

You can add archives beyond Wikipedia — TED talks, Stack Overflow, Project Gutenberg, etc. Browse https://download.kiwix.org/zim/ and download additional `.zim` files to `/opt/pandoras-box/offline-kb/zim/`. Restart the container:

```
sudo launchctl stop com.pandoras-box.offline-kb-kiwix
sudo launchctl start com.pandoras-box.offline-kb-kiwix
```

Kiwix auto-detects new ZIMs in the mount dir.

## Why Docker specifically

Kiwix-serve runs natively on Linux but is awkward to package on macOS without Docker. The container is small (~80 MB) plus the ZIM files. If you'd rather avoid Docker, you can install `kiwix-serve` directly via `brew install kiwix-tools` and skip the container — but the installer assumes Docker by default.

## Performance

- ZIM lookups are local — sub-100ms even for large archives.
- Memory: ~200 MB for the container plus OS page-cache for hot ZIM regions.
- Disk: ~30 GB for English Wikipedia (top 6,000 articles); ~80 GB for full Wikipedia; pick what you want.

## Revoking / decommissioning

```
sudo launchctl unload /Library/LaunchDaemons/com.pandoras-box.offline-kb-kiwix.plist
docker rm -f kiwix-serve
sudo rm -rf /opt/pandoras-box/offline-kb/zim/
```

Recovers ~30-80 GB of disk.
