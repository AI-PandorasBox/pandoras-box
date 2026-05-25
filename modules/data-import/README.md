# data-import

Bring memories you already have from another assistant into your Pandora's Box
Personal Assistant. Each imported item becomes a remembered **fact** in your
assistant's memory (`memory.db`), so it can use them in future conversations.

Local-file only. Nothing is uploaded; nothing leaves your Mac. Every import is
reversible.

## Install

```bash
bash modules/data-import/install.sh   # puts `pbox-import` on your PATH
```

Requires the **personal-ai** module (it writes into its `memory.db`) and Node 22+
(`node:sqlite`).

## Use

```bash
# Preview first (writes nothing):
pbox-import --from jsonl --path my-export.jsonl --dry-run

# Import (label the batch so you can undo it):
pbox-import --from jsonl --path my-export.jsonl --tag old-assistant

# Markdown notes:
pbox-import --from markdown --path notes.md

# Undo a batch:
pbox-import --undo old-assistant
```

### Sources

- `jsonl` — one JSON object per line (or a JSON array). Recognised fields:
  `text` / `content` / `message` / `body`, or `role` + `content`. Plain text
  lines work too.
- `markdown` — split into blocks (paragraphs / sections), one fact each.
- `claude-desktop`, `openclaw`, `hermes` — native parsers are stubbed pending
  confirmation of each tool's export shape. For now, export those to JSONL and
  use `--from jsonl`. (Tracked as the v1.1 follow-up.)

## Safety

- **Local files only**, no network, no new credentials, no child processes.
- Input is treated as data, never executed. File size (50 MB) and record count
  (`--limit`, default 5000) are capped; each fact is truncated to 4000 chars.
- Each import writes a batch manifest under `<store>/imports/<tag>.json`
  recording the inserted row IDs, so `--undo <tag>` removes exactly that batch.

## Roadmap (v1.1)

- Native Claude Desktop / OpenClaw / Hermes adapters once their export formats
  are confirmed.
- Optional `--target kb` to chunk + embed into the offline-kb vector store.
- Import chats as conversations (not only facts).
