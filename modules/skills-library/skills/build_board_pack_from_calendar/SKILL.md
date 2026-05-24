---
name: build_board_pack_from_calendar
description: >
  Builds a board pack PDF from MS365 calendar data. Pulls calendar events
  week-by-week from a caller-supplied mailbox tenant, assembles into an xlsx
  workbook with row-count verification, and renders to PDF via Chrome headless.
  Tenant-agnostic: caller passes mailbox_tenant_key directly. Resumable via run_id.
tools:
  - personal-ai MCP get-calendar-view (any tenant the caller has access to)
files:
  - skill.mjs
  - board_pack_template.mjs
version: 2.0.0
author: Pandora's Box
guard: _SKILL_TENANT_AGNOSTIC_V1
---

# build_board_pack_from_calendar

A tenant-agnostic skill. The caller supplies which mailbox to query; the skill
does not interpret company names or alias lists.

## Usage

```javascript
build_board_pack_from_calendar({
  mailbox_tenant_key: "my-mailbox",      // any valid MCP tenant key
  period:             "Q1-2026",         // Q1-Q4 YYYY or W1-W18-YYYY
  output_label:       "acme-Q1-2026",    // optional cover line + filename label
  output_dir:         "/tmp/reports",    // optional copy destination
  run_id:             "a3b7c1f2",        // optional resume ID
})
```

`mailbox_tenant_key` is passed straight to the personal-ai MCP tenant resolver.
Any tenant provisioned in your install will work; the skill emits a clean error
if the key is unknown.

`output_label` is purely cosmetic. It appears as the cover line on the PDF and
is sanitised into the xlsx/pdf filenames. Defaults to `mailbox_tenant_key`
if omitted.

## Returns

```json
{
  "ok": true,
  "run_id": "a3b7c1f2",
  "mailbox_tenant_key": "my-mailbox",
  "output_label": "acme-Q1-2026",
  "period": "Q1-2026",
  "weeks_processed": 13,
  "weeks_summary": [{ "week": "W01", "events": 4, "status": "complete" }],
  "xlsx_path": "/.../board-pack-acme-Q1-2026.xlsx",
  "pdf_path": "/.../board-pack-acme-Q1-2026.pdf",
  "run_dir": "/.../runs/a3b7c1f2"
}
```

## Resume behaviour

If a run is interrupted (calendar timeout, process kill), call again with the
same `run_id`. Weeks already completed (written to `runs/<id>/weeks/`) are
skipped. Only remaining weeks are fetched.

## Stages

1. **Calendar pull** -- per-week `get-calendar-view` with 3-attempt retry +
   2s backoff. Checkpoint written after each week.
2. **Xlsx assembly** -- exceljs workbook with Summary sheet + per-week sheets.
   Row-count verify after each sheet -- throws on mismatch (no silent truncation).
3. **PDF render** -- prints HTML via Chrome headless. Falls back gracefully
   (returns xlsx_path) if Chrome fails.

## Period formats

| String      | Weeks       |
|-------------|-------------|
| Q1-2026     | W01 - W13   |
| Q2-2026     | W14 - W26   |
| Q3-2026     | W27 - W39   |
| Q4-2026     | W40 - W52   |
| W1-W18-2026 | W01 - W18   |

## Branding presets (optional)

Pass `preset: "<name>"` to load brand colours + a cover footer from
`presets/<name>.json` (alongside this skill). Presets are operator-specific and
are NOT shipped with this module -- create your own. A preset has the shape:

```json
{
  "brand": { "colors": { "primary": "#1F3864", "secondary": "#2E4057",
                          "accent": "#C9A961", "bg": "#ffffff", "text": "#1a1a1a" } },
  "defaults": { "cover_footer": "Your Company -- Board Pack" }
}
```

## Architectural note

Skills are pool primitives: the same code path serves any agent that has the
appropriate mailbox tenant access. Per-company defaults belong in the agent
activation layer (agent-card / activation), never inside the skill.

## Dependencies

Needs Node modules (`exceljs`, etc.) and a calendar MCP. By default the skill
resolves them from `/opt/pandoras-box/personal-ai/runtime`; override with the
`PBOX_NODE_BASE` environment variable. The personal-ai module provides these.
