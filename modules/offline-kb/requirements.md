# offline-kb -- Requirements

| Requirement | Value |
|-------------|-------|
| OS | macOS 13+ (Apple Silicon or Intel) |
| Node.js | 22+ (uses `node:sqlite` builtin) |
| Docker | Docker Desktop or equivalent with `docker compose` v2 |
| Disk | 2 GB minimum (Simple Wikipedia). Up to ~100 GB for full Wikipedia. |
| Network | One-time download from `download.kiwix.org`. No runtime egress. |
| Ports | `127.0.0.1:8090` (wrapper), `127.0.0.1:8089` (Kiwix container) |

## Why Docker

Kiwix's macOS native binary is third-party and unsigned. The container image
(`ghcr.io/kiwix/kiwix-serve`) is the upstream-supported distribution path
and is the only one this module installs.

## No npm Dependencies

The wrapper uses Node 22 builtins only (`node:http`, `node:fs`, `node:path`,
`node:sqlite`). No `package.json`, no `node_modules`.
