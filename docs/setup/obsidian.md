# Setup — Obsidian (vault-graph module)

The **vault-graph** module renders your Personal Assistant's memory as an
Obsidian vault on disk: an index that links your pinned **Facts** and
conversation **Threads**, so you can browse and explore it in Obsidian's graph
view. It regenerates automatically from `memory.db`.

## Prerequisites

- The **personal-ai** and **vault-graph** modules installed.
- Obsidian (free): `brew install --cask obsidian`.

## Vault location

The vault-graph module writes the vault to:

```
/opt/pandoras-box/vault-graph/vault/
```

(or `<your install path>/vault-graph/vault/`). Structure:

```
index.md            # home: links to Facts + every Thread (this is the graph)
Facts.md            # your pinned facts
Threads/<title>.md  # one note per conversation, linked back to index
```

## Open the vault in Obsidian

First run: **Open folder as vault** → choose
`/opt/pandoras-box/vault-graph/vault/` → Open. Then open the command palette
(Cmd-P) → **Graph view: Open graph view** to see Facts and Threads connected
through the index.

Notes are plain Markdown with `[[wikilinks]]`. You can add your own notes and
folders alongside; the module only rewrites the files it generates.

## Recommended plugins (optional)

Obsidian → Settings → Community plugins → Browse: **Dataview** (query the vault),
**Templater** (note templates).

## How it stays current

The module re-renders every 10 minutes (`VAULT_GRAPH_INTERVAL_SEC`). It reads
memory; it does not delete notes you add by hand.

## Roadmap

A richer entity graph (People / Commitments / Projects folders with backlinks)
and two-way sync (your Obsidian edits flowing back into memory) are planned —
see the module README.

## Decommissioning

```
bash modules/vault-graph/uninstall.sh
```

The vault remains on disk as plain Markdown — your data isn't lost; the module
just stops regenerating it.
