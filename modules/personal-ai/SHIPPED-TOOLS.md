# Shipped Tools — Pandora's Box public personal-ai

This file is the honest, reviewable record of exactly which tools a fresh public install
gets, split into three buckets: **shipped WITH a working executor**, **schema-only
(catalogue-listed but NOT offered to the model)**, and **excluded entirely**. It exists
so Ian can apply box-safety judgement before any public push.

- Full catalogue: `runtime/tool-catalogue.json` (69 schemas: 65 vetted/sanitised/leak-scanned + 4 local-content re-adds).
- Executors: `runtime/tool-executors.mjs` (frozen, self-contained; local SQLite + sandbox only).
- Wiring: `runtime/pbox-personal-ai.mjs` (`_PUBLIC_TOOLS_V1`).

## The hard rule the runtime enforces

A catalogue tool is **offered to the model only if a working executor exists for it.**
A tool with a schema but no executor is **never offered** — it would fail at call time,
which is worse than being absent. This closes the audit's headline gap ("9 tools, no
upgrade path, README claims 181") honestly: the public box now offers the **48 tools it
can actually run**, not a list of names that error.

Counts: catalogue **69** -> offered with executors **48** -> schema-only/withheld **21**.

---

## 1. SHIPPED WITH EXECUTOR (48) — these run on a stock box

All run against this box's own `personal-ai/store/memory.db` + a sandboxed filesystem
(`store/vault`, `store/drops`, `store/generated`). No master DB, no shared schema, no
secrets, no multi-tenant access.

### Personal data (always work, no external dependency)
| Tool | Store |
|---|---|
| save_memory, recall_memory, update_memory, delete_memory | `pai_memories` (+ FTS5 recall) |
| get_tasks, add_task, update_task | `pai_tasks` |
| search_contacts, add_contact, update_contact, delete_contact | `pai_contacts` (email dedup) |
| important_list_read, important_list_add, important_list_remove | `state/important-list.json` |
| commitment_add, commitment_list, commitment_done | `pai_commitments` |
| graph_upsert_entity, graph_upsert_relationship, graph_find_entity, graph_find_person | `pai_graph_*` |
| place_upsert, place_list, place_delete | `pai_places` |
| schedule_task, schedule_list | `pai_schedule` (records the schedule; firing is the runtime's job) |

### Local content (always work, dependency-free generators)
| Tool | Notes |
|---|---|
| vault_read, vault_write, vault_search, vault_list | sandboxed under `store/vault`; path-traversal blocked |
| save_file, list_drops, read_drop_file, delete_drop_file, delete_drops_batch, rename_drop_file | sandboxed under `store/drops`; filename-whitelisted; delete is sha256-logged-shaped |
| generate_pdf | dependency-free valid PDF (monospaced text layout) |
| generate_docx | dependency-free valid OOXML `.docx` (hand-built ZIP) |
| generate_xlsx | dependency-free valid OOXML `.xlsx` (hand-built ZIP) |

### Calendar (local registry + outbound READ)
| Tool | Notes |
|---|---|
| ical_list_sources, ical_register_source | local alias registry (`pai_ical_sources`), HTTPS-only |
| fetch_ical | outbound **read-only** ICS fetch; SSRF-guarded (refuses private/loopback hosts) |

### Search (outbound READ, **gated on a user-supplied key** — never fabricates)
| Tool | Requires | No-key behaviour |
|---|---|---|
| brave_search | `BRAVE_API_KEY` | returns a clear "configure key" error |
| grounded_search | `GEMINI_API_KEY` | returns a clear "configure key" error |
| deep_research | `GEMINI_API_KEY` | runs grounded synchronously; clear error if no key |
| get_stock_quote | `ALPHAVANTAGE_API_KEY` | returns a clear "configure key" error |
| search_knowledge | `OFFLINE_KB_URL` (offline-kb module) | honest "not available" note |

### Built-in
| Tool | Notes |
|---|---|
| run_skill | runs a packaged skill from `shared/skills/library/<id>/v1/skill.mjs`; skill tool calls resolve against the 48 executors above |

---

## 2. SCHEMA-ONLY — in the catalogue, **NOT offered** to the model (21)

These have a vetted schema but **no box-safe executor**, so the runtime withholds them.
Each needs an external service, paid API, or browser/host capability that a public box
cannot be assumed to have. Listed here so Ian can decide which (if any) to promote later
once their box-safety is judged.

| Tool | Why withheld (needs Ian's judgement to promote) |
|---|---|
| session_close_extract | needs server-side session-history extraction (the **session-close-extract _skill_** still works via save_memory + vault_write) |
| capture_artefact, vision_read | need Gemini Vision API + Chrome render; box-safe IF user provides a key + chrome — promote candidate |
| book_research, book_set_research, book_outline, book_write_chapter, book_cover_generate, book_interior_graphics, book_assemble, book_listing_generate, book_publish_kdp, book_status, book_list, book_analytics, book_review_drafts | KDP book pipeline; needs Claude/Gemini generation + (publish) browser automation. `book_publish_kdp` returns a **web_action plan** = drive-mode, excluded. The research/write/assemble subset is a promote candidate once an LLM key path is wired |
| app_research | Play Store scraping; promote candidate (read-only) but unproven box-safety |
| zimit_scrape | requires Docker on the host; promote candidate where Docker present |
| lyria_generate, veo_generate, fal_generate_video | paid generative-media APIs, per-second/per-clip billing; deliberately off for cost-safety |

---

## 3. EXCLUDED ENTIRELY — not even in the public catalogue

The vetted catalogue (`catalogue-vetted.json`, 65 tools; shipped as 69 with the 4
local-content re-adds) already excludes the master-only
130 tools at generation time (allow-list + sanitiser + leak-scan in
`generate-tool-catalogue.mjs`). For the record, the categories deliberately kept out and
which this module must never ship an executor for:

- **run_script** and anything that shells out to operator-controlled strings.
- **web_action_\*** (drive-mode browser automation).
- **ms365_\*** multi-tenant mail/calendar (a public user wires their own single account;
  left as the existing scaffold modules — not faked here).
- **admin / zeus / conductor / clio / calliope / nemesis / melete / aetheria / levels_crm**
  and all operator/agent-internal tools.
- **ftp / any network-write**.

---

## Activation gating

The runtime reads `shared/agent-activation.json` (single-user default agent id `muse`).
If that file lists `tools_active`, **only those tools are offered** (intersected with the
48 executable tools). Absent/unreadable matrix => no gating => all 48 offered. The public
dashboard's Activation page (see `modules/dashboard`) toggles `tools_active` and the
runtime honours it on the next turn. This is the operator's per-agent on/off knob.

## What needs Ian's box-safety judgement

1. Promote `capture_artefact` + `vision_read` and the `book_*` write subset once a
   user-LLM-key path is acceptable to ship publicly.
2. Confirm `fetch_ical`'s SSRF guard is sufficient for the public threat model
   (currently refuses `127.*/10.*/192.168.*/169.254.*/loopback`).
3. Confirm the search-tool key env names (`BRAVE_API_KEY`, `GEMINI_API_KEY`,
   `ALPHAVANTAGE_API_KEY`) are the ones the public installer should prompt for.
