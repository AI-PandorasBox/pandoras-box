# Multi-Tenant Setup

## Overview

Multi-tenant in Pandoras Box means running agents for multiple companies on the same physical
machine, with full isolation between them. Each company gets its own OS service account,
directory tree, credential files, and set of LaunchDaemons. No data, credentials, or process
memory is shared between companies.

## What One Tenant Looks Like

A single tenant consists of:

- **One OS service account** (e.g. `company-a-agent`, UID assigned at install time)
- **One base directory** at `/opt/pandoras-box/company-a/` -- holds shared `node_modules` and
  credentials
- **One conductor** at `/opt/pandoras-box/company-a-conductor/`
- **Four task agents** at `/opt/pandoras-box/company-a-{mail,calendar,files,voice}/`
- **Six LaunchDaemon labels:**
  - `com.pandoras-box.company-a-conductor`
  - `com.pandoras-box.company-a-mail`
  - `com.pandoras-box.company-a-calendar`
  - `com.pandoras-box.company-a-files`
  - `com.pandoras-box.company-a-voice`
  - (plus a base label if applicable)
- **Separate `.env` file** for each service (credentials scoped to that service)

## Directory Structure

A two-company installation:

```
/opt/pandoras-box/
  argus/
    argus.mjs
    store/
  muse/
    conductor.mjs
    store/
  company-a/                         # Base dir (node_modules + creds)
    node_modules/
    .env                             # chmod 600, owner: company-a-agent
    store/
      ms365-auth/                    # Token cache backups
  company-a-conductor/
    conductor.mjs
    .env                             # chmod 600
  company-a-mail/
    agent.mjs
    .env                             # chmod 600
  company-a-calendar/
    agent.mjs
    .env                             # chmod 600
  company-a-files/
    agent.mjs
    .env                             # chmod 600
  company-a-voice/
    agent.mjs
    .env                             # chmod 600
  company-b/                         # Base dir for Company B
    node_modules/
    .env
    store/
  company-b-conductor/
  company-b-mail/
  company-b-calendar/
  company-b-files/
  company-b-voice/
```

## How the Installer Provisions a Tenant

The installer wizard (`sudo bash /opt/pandoras-box/scripts/install.sh`) prompts for:

1. Number of companies to set up
2. Slug for each company (e.g. `company-a`) -- used in directory names and labels
3. Display name for each company (used in logs and briefings)
4. Mail integration type per company: MS365 or Google
5. Optional modules to enable (calendar, files, voice, relay, etc.)

For each company, the installer then:

1. Creates a service account: `sudo dscl . -create /Users/company-a-agent`
2. Assigns a UID and sets the home directory
3. Creates the directory tree with `mkdir -p` and sets permissions to `750`
4. Writes six plist files to `/Library/LaunchDaemons/` with the correct service account
5. Loads each plist: `sudo launchctl load /Library/LaunchDaemons/com.pandoras-box.company-a-*.plist`
6. Prompts for API keys and OAuth credentials
7. Writes `.env` files with `chmod 600` and the correct ownership
8. Runs a health check to verify all six services are running

## Isolation Enforcement

| Layer | Mechanism |
|-------|-----------|
| OS filesystem | Directories `750`, credential files `600` -- service account can read its own files only |
| Job queue | Every job record includes `company_id`; each agent queries only `WHERE company = 'company-a'` |
| Process memory | Each agent runs as a separate Node.js process; no shared heap between companies |
| Tool allowlist | `canUseTool` interceptor prevents agents from calling tools outside their scope |

## Adding a New Company After Install

```bash
sudo bash /opt/pandoras-box/scripts/add-tenant.sh
```

The script runs the same provisioning steps as the original installer for a single new
company. Existing companies are not affected.

## Removing a Company

```bash
sudo bash /opt/pandoras-box/scripts/remove-tenant.sh company-slug
```

**Warning:** This is irreversible. The script will:
- Unload and delete all six LaunchDaemon plists for the company
- Remove the directory tree at `/opt/pandoras-box/company-slug*/`
- Delete the OS service account
- Remove the company's job queue entries from `jobs.db`

Back up the company's `.env` files and token caches before running this script.

## Example Three-Company Configuration

| Company slug | Service account | Conductor label |
|-------------|-----------------|-----------------|
| company-a | company-a-agent | com.pandoras-box.company-a-conductor |
| company-b | company-b-agent | com.pandoras-box.company-b-conductor |
| company-c | company-c-agent | com.pandoras-box.company-c-conductor |

Each company also has four task agent labels following the same pattern
(`com.pandoras-box.company-a-mail`, etc.).

## Performance Notes

Each conductor process uses approximately 50-80 MB RAM at idle. A three-company installation
with all agents running typically uses 600-900 MB RAM for the agent processes alone.

If the `ollama` module is enabled, the Ollama process requires an additional 8-12 GB RAM when
a model is loaded. The `gemma3:12b` model (the default) requires a machine with at least 16 GB
RAM total. On machines with 8 GB RAM, disable the `ollama` module and rely on the Anthropic
API for all classification.
