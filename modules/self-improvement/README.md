# self-improvement

> **Agent Self-Improvement Pipeline**

**Status:** Optional
**Depends on:** core, personal-ai

## What It Does

Agent self-improvement pipeline using GEPA (Generalised Error-driven Prompt Adjustment)
and a skill library.

the Self-Improvement Pipeline analyses agent performance logs weekly, identifies patterns in successful and
unsuccessful interactions, and generates prompt adjustments. Adjustments are applied on
the next cycle after review.

Over time, your agents become more accurate and relevant to your specific use cases.

## Schedule

- GEPA optimisation: Saturday 22:00
- Sunday review: Sunday 08:00
- Skill review interval: 72 hours

## Monthly Cost

Zero API cost for the GEPA optimiser (deterministic heuristics, no LLM calls).
Morpheus embeds locally (free) and makes one judge call per 8 candidate groups (40 groups a week = 5 calls).

## GEPA optimiser

GEPA = Generated Edit Proposals, Aggregated. Runs alongside the legacy
weekly review on the Sunday cron.

**Inputs**

The optimiser reads the Personal AI module's session log:

```
${INSTALL_PATH}/personal-ai/store/sessions/YYYY-MM-DD.jsonl
```

One JSONL file per day. Each line:

```json
{"ts":"...","conversation_id":"abc","role":"assistant","content":"...","rating":2,"regenerated":false,"corrected":false}
```

If the directory is missing or empty, the digest will say so and exit cleanly.

**What it detects**

- **Rejected:** assistant turns where `rating != null && rating < 3`
- **Regenerated:** assistant turns where `regenerated === true`
- **Corrected:** assistant turns where `corrected === true` (the next
  operator turn is captured as the correction text)

For each candidate the digest quotes the preceding user turn, the
assistant's response, and (for corrections) the operator's follow-up.
A deterministic suggestion is added per kind. No LLM is called.

**Output**

```
${INSTALL_PATH}/self-improvement/output/weekly-YYYY-MM-DD.md
```

**Operator-gated**

The digest writes a markdown file. It does NOT modify any prompt. It does
NOT touch the personal-ai module. To adopt a proposed edit, copy the
suggested text into your own prompt source under
`${INSTALL_PATH}/personal-ai/prompts/` (or follow your repo's
prompt-management workflow).

**Testing locally**

```
PBOX_SESSIONS_DIR=/tmp/test-sessions \
PBOX_GEPA_OUT_DIR=/tmp/test-out \
node modules/self-improvement/runtime/gepa-optimiser.mjs
```

## Morpheus: memory consolidation ("dreaming")

`runtime/morpheus-consolidate.mjs` tidies an agent's long-term memory store between sessions, in the
spirit of Anthropic's Managed Agents *Dreams*, but conservatively: it **never deletes or rewrites** a
memory. It only retires redundant rows by setting `invalid_at` (recall already ignores invalid rows),
logs every change per run, and can undo a whole run with one command.

1. **Exact copies** (same text after normalising) are found without any model; the most-used, then
   newest, copy is kept.
2. **Near-duplicates and possible contradictions** are found with local embeddings (Ollama,
   `nomic-embed-text` by default, no API cost).
3. **A judge model** decides each candidate group: `duplicate`, `superseded` (a later memory corrects
   an earlier one), `distinct` (for example daily logs for different days), or `conflict`. It is told to
   prefer `distinct` when unsure, it can never retire a whole group, a memory is only retired if
   every fact in it is also in the one kept (the judge must list anything that would be lost), a newer
   memory is never retired in favour of an older one unless they are exact copies, and **conflicts are never resolved
   automatically**: they are listed for a human to settle. Different figures for the same thing in the
   same period are treated as conflicts.

```
node runtime/morpheus-consolidate.mjs report [--db PATH] [--max N]   # propose only (default)
node runtime/morpheus-consolidate.mjs apply  [--db PATH] [--max N]   # propose + retire redundant rows
node runtime/morpheus-consolidate.mjs undo   --run RUN_ID            # restore everything a run retired
node runtime/morpheus-consolidate.mjs report --files DIR             # a folder of markdown memories (report only)
```

Settings (environment): `MORPHEUS_ADAPTER` (a module exporting `makeMessageFull(system, messages, opts)`;
without one, only exact copies are handled), `MORPHEUS_CATEGORIES` (comma list of categories to judge),
`MORPHEUS_EMBED_MODEL`, `OLLAMA_URL`, `MORPHEUS_OUT` (where the run report goes). `--max` bounds how many
candidate groups are judged per run (default 40), so a large backlog clears over several weeks.

Expected schema: a `memories` table with `id, content, category, created_at, reference_count,
invalid_at`. Each run writes `<run>.md` and `<run>.json` reports; `apply` also creates a
`morpheus_undo` table in the same database.

## How to Install

```
sudo bash modules/self-improvement/install.sh
```

## Uninstall

```
sudo launchctl stop com.pandoras-box.self-improvement-gepa
sudo launchctl stop com.pandoras-box.self-improvement-review
```

Remove `SELF_IMPROVEMENT_ENABLED=true` from `/opt/pandoras-box/self-improvement/.env`.
