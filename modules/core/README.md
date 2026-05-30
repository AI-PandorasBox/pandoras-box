# core

> **Base System**

**Status:** Required
**Installed by:** `pbox-setup.sh`

## What It Does

The `core` module is the foundation of your AI system. It installs:

- The Security Overseer daemon (independent oversight process)
- The job queue (SQLite database at `/var/ai-jobs/jobs.db`)
- One Conductor per company (message intake and routing)
- Four Task Agents per company (Mail, Calendar, Files, Voice)
- The base directory structure under `/opt/pandoras-box/`
- All LaunchDaemon service plists

All other modules depend on `core`.

## Requirements

- macOS 14 (Sonoma) or later
- Node.js 20 or later (`brew install node`)
- Homebrew
- Claude Pro or Max subscription (signed in via `claude /login`)

## Installation

`core` is installed automatically by running:

```
sudo bash pbox-setup.sh
```

It cannot be installed independently.

## Uninstall

Uninstalling `core` removes the entire system. This is irreversible.

```
sudo bash /opt/pandoras-box/scripts/uninstall.sh
```

This stops all services, removes all plists, removes `/opt/pandoras-box/`, and deletes
all service accounts. It does NOT delete your email, calendar events, or documents --
those live in Microsoft 365 or Google Workspace.
