# vault-graph

Exposes your assistant's memory as an **Obsidian vault** on disk. It reads the
Personal Assistant's `memory.db` and writes linked Markdown notes — pinned
**Facts**, conversation **Threads**, and an **index** that links them — so you
can browse and explore the relationships in Obsidian's graph view. Agents and
you read/write the same notes.

## Install

```bash
bash modules/vault-graph/install.sh
```

Requires the **personal-ai** module. Regenerates every 10 minutes (configurable).

## Where the vault lives

```
<install>/vault-graph/vault/
  index.md            # home: links to Facts + every Thread (this is the graph)
  Facts.md            # pinned facts
  Threads/<title>.md  # one note per conversation, linked back to index
```

Open that folder as a vault in Obsidian (`brew install --cask obsidian`) and use
the graph view. Notes are plain Markdown with `[[wikilinks]]`.

## Config (env)

| var | default | meaning |
|-----|---------|---------|
| `VAULT_GRAPH_INTERVAL_SEC` | 600 | how often to regenerate |
| `VAULT_GRAPH_DIR` | `<install>/vault-graph/vault` | output vault path |

## Roadmap (v1.1)

- Entity extraction (People / Commitments) with backlinks for a richer graph.
- Two-way sync (edits in Obsidian flow back into memory).
