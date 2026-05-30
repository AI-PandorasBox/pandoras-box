# vector-kb

Local **semantic memory** for your assistant. Text you store here is turned into
an embedding by a **local** model (via the `ollama` module — no cloud, no API
cost), saved in SQLite, and retrieved by meaning rather than keyword.

This is the **vector** layer of the memory system (alongside pinned facts in the
Personal Assistant and the Obsidian vault-graph). `pbox-import --target kb` writes
imported memories straight in here.

## Install

```bash
bash modules/vector-kb/install.sh
ollama pull nomic-embed-text     # the default embedding model (one-time)
```

Localhost-only LaunchDaemon on port **8486**.

## API (localhost)

```bash
# add memories
curl -s localhost:8486/ingest -H 'content-type: application/json' \
  -d '{"text":"Northwind prefers sea-view rooms","source":"notes"}'

# semantic search
curl -s 'localhost:8486/search?q=room%20preferences&k=5'

# health
curl -s localhost:8486/healthz      # {ok, items, model, ollama}
```

`POST /ingest` accepts a single `{text, source?, tags?}` or `{items:[...]}`.
`DELETE /item?id=N` removes one (used by `pbox-import --undo`).

## Notes

- **Local + offline:** embeddings come from Ollama on 127.0.0.1; nothing leaves
  your Mac. Requires the `ollama` module and an embedding model pulled.
- Search is exact cosine over stored vectors — fine for a personal store
  (thousands of items). A native vector index is a future optimisation.
- Bodies are capped (5 MB request, 8000 chars/item).
