# Setup — Obsidian (vault graph module)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

The Vault Graph module exposes your Personal AI's memory + relationship graph as an Obsidian vault on disk. You can browse it visually with Obsidian's native graph view; agents can read and write notes into it via the MCP filesystem.

## Prerequisites

- Obsidian installed (free).

## Setup steps

### 1. Install Obsidian

```
brew install --cask obsidian
```

Or download from https://obsidian.md.

### 2. Vault location

The Pandora's Box installer creates the vault automatically at:

```
/opt/pandoras-box/mnemosyne/store/obsidian-vault/
```

This is the only vault path the agents write to. Don't delete or move it.

### 3. Open the vault in Obsidian

First run of Obsidian:
- **Open folder as vault** → navigate to `/opt/pandoras-box/mnemosyne/store/obsidian-vault/` → Open.

Subsequent runs: Obsidian remembers the path.

### 4. Enable the graph view

Obsidian → command palette (Cmd-P) → "Graph view: Open graph view".

The graph shows all entities the agents have recorded — people, organisations, projects, threads, commitments — connected by relationships.

### 5. Recommended Obsidian plugins (optional)

In Obsidian Settings → Community plugins → Browse:

- **Dataview** — query the vault programmatically
- **Excalidraw** — diagram embedding (if you want to draw architecture diagrams alongside notes)
- **Templater** — note templates (the installer ships a few)

## How agents use the vault

Agents read and write notes via the MCP filesystem server. The vault has these top-level folders:

```
People/       — one note per person ever mentioned
Threads/      — one note per ongoing conversation thread
Commitments/  — promises made by either you or the agent
Projects/     — project notes
Meetings/     — meeting notes (synced from Calendar module)
Inbox/        — agent draft notes pending review
```

The Personal AI maintains these automatically. You can add your own folders alongside without conflict.

### Conflict between agent writes and your edits

If you edit a note in Obsidian, agents will not overwrite your edits on next sync — they respect content timestamps and append to a thread rather than rewriting. If you delete an entity note, the agent recreates a fresh one on next mention (deduplicating against external IDs like email address).

## Verifying it works

Ask your Personal AI:

```
who are my contacts at ExampleCorp
```

You should see a list, and in Obsidian → `People/` you'll find a note per contact with relationship metadata.

## Performance

For vaults >5,000 notes, enable Obsidian's "Lazy load" setting → Settings → Files & Links → Files & Links → "Lazy load". The agents themselves don't load the vault into memory; they query via MCP per-call.

## Revoking / decommissioning

Quit Obsidian. The vault remains on disk as plain Markdown — your data isn't lost. To stop the agents writing to it, disable the Vault Graph module:

```
sudo bash /opt/pandoras-box/scripts/disable-module.sh vault-graph
```

The module stops writing. You can keep using Obsidian on the vault as a personal knowledge base.
