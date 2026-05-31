---
name: brand_sweep
description: >
  Tenant-agnostic brand availability primitive. Takes brand_name, byline, platforms,
  TLDs, trademark classes, and byline catalogs as inputs; runs handle, domain,
  trademark, and byline availability sweeps; synthesises a reservation action plan;
  renders a combined PDF deliverable via Chrome headless. Never contains closed
  company enums. Defaults are the Example Brand/Your Name values.
tools:
  - Chrome headless (local) — PDF render via pdf-render.mjs
  - RDAP public API (rdap.org) — domain availability
  - UK IPO TMtext / USPTO TESS API / EUIPO TMview — trademark search
  - Open Library JSON API — byline author conflict check
  - HTTP profile scrape — social handle availability
files:
  - sweep-handle.mjs      — social handle availability across configurable platforms
  - sweep-domain.mjs      — domain availability via RDAP + price table
  - sweep-trademark.mjs   — trademark conflict check (UK IPO, USPTO, EUIPO) with retry
  - sweep-byline.mjs      — author byline conflict check (Open Library + HTML sources)
  - action-plan.mjs       — synthesiser: reads sweep outputs, produces action plan
  - pdf-render.mjs        — orchestrator: runs all sweeps, composes PDF deliverable
version: 1.0.0
author: Pandora's Box
created: 2026-05-14
guard: _BRAND_SWEEP_TOOL_V1
---

# brand_sweep

A **tenant-agnostic** brand availability sweep and action plan primitive. Caller
passes brand inputs; the skill runs all five checks and returns both markdown reports
and a single PDF synthesis suitable for sharing with legal counsel or advisors.

## Usage

```javascript
brand_sweep({
  brand_name:        "example-brand",          // required
  byline:            "Your Name",           // optional — default "Your Name"
  fallback_brands:   ["examplestudio"],        // optional — default derived from brand_name
  platforms:         null,                   // optional — default 8-platform list
  tlds:              null,                   // optional — default 8-TLD list
  trademark_classes: [9, 16, 41],            // optional — default [9, 16, 41]
  byline_catalogs:   null,                   // optional — default 5-source list
  output_target:     "drops",               // optional — drops | sharepoint:<alias> | ftp:<alias>
})
```

## Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `brand_name` | string | yes | — | Primary brand handle (lowercase, no @, no spaces) |
| `byline` | string | no | `"Your Name"` | Author pen name for byline conflict check |
| `fallback_brands` | string[] | no | `[brand_name + "studio", brand_name + "media"]` | Fallback handles checked if primary taken on ≥2 platforms |
| `platforms` | object[] | no | 8-platform default | Platform configs (YouTube, IG, TikTok, X, Threads, Bluesky, Mastodon + YT Shorts) |
| `tlds` | object | no | 8-TLD price table | TLD → {reg, renew, note} map |
| `trademark_classes` | number[] | no | `[9, 16, 41]` | Nice classes to check |
| `byline_catalogs` | object[] | no | 5-source default | Source configs for byline check |
| `output_target` | string | no | `"drops"` | Where to deliver PDF. `drops` = internal. `sharepoint:<alias>` or `ftp:<alias>` = external (Argus gate applies) |

## Returns

```json
{
  "ok": true,
  "brand_name": "example-brand",
  "reports": {
    "handle":    "./reports/example-brand-handle-sweep-2026-05-14.md",
    "domain":    "./reports/example-brand-domain-sweep-2026-05-14.md",
    "trademark": "./reports/example-brand-trademark-2026-05-14.md",
    "byline":    "./reports/example-brand-byline-2026-05-14.md",
    "action_plan": "./reports/example-brand-action-plan-2026-05-14.md"
  },
  "pdf_path": "./documents/brand-sweep-example-brand-2026-05-14.pdf",
  "pdf_url":  "/api/pdf-download/<id>"
}
```

## Sweep modules

### sweep-handle.mjs
Checks `@brand_name` across 8 platforms. If taken on ≥2 platforms, runs fallback
sweep over all `fallback_brands`. Returns markdown report.

### sweep-domain.mjs
Queries RDAP for each TLD. Reports availability, registrar, expiry. Ranks available
domains by preference order. Returns markdown report with cost table.

### sweep-trademark.mjs
Queries UK IPO, USPTO TESS, and EUIPO TMview for the brand name in each Nice class.
Grades each result: `clean` | `soft-conflict` | `hard-conflict`. Retries on 5xx
with exponential backoff. Returns markdown report.

### sweep-byline.mjs
Searches Open Library (JSON API) and HTML-scrapes Amazon UK, Goodreads, LoC, WorldCat
for the author byline. Reports name collisions. Returns markdown report.

### action-plan.mjs
Reads the four markdown reports and synthesises a prioritised action plan. If primary
brand is blocked, surfaces Plan B candidates.

### pdf-render.mjs
Orchestrates all five modules. Composes HTML → renders PDF via Chrome headless (same
infrastructure as `generate_pdf`). Copies to drops and returns paths.

## Example Invocations

### Via the assistant chat
```
Run a brand sweep for "example-brand"
```
```
Check availability for brand name "example-brand" — byline "Your Name", trademark classes 9, 16, 41
```
```
Brand sweep for "acme-press" with fallbacks acmerecords, acmemedia
```

### Via the brand_sweep tool
```json
{
  "brand_name": "example-brand",
  "byline": "Your Name",
  "trademark_classes": [9, 16, 41]
}
```

### Via the assistant UI
Call the brand_sweep skill with a brand name to run the sweep.

### Via API
```bash
curl -s -X POST http://localhost:8888/api/brand-sweep/run \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<token>" \
  -d '{"brand_name":"example-brand","byline":"Your Name"}'
```

<!-- _BRAND_SWEEP_DOC_V1 -->

## Security Model

- All HTTP calls are outbound GET to public endpoints. No credentials required.
- PDF output lands in `drops/general/documents/` by default (internal, no Argus gate).
- External targets (`ftp:*`, `sharepoint:*`) use the existing `design_external_write`
  Argus job class from the design-module — same gate, same approval flow.
- Each sweep call is logged to audit.log: `event: brand_sweep, brand_name, output_target`.
- Never evaluates brand name or byline as code. All inputs are treated as data strings.

## Architectural note

Company-agnostic per Pbox v2 `feedback_skills_company_agnostic`. Never add company
names or closed enums to this module. Default values (Example Brand/Your Name) are
documented examples, not requirements — pass your own brand inputs at call time.
