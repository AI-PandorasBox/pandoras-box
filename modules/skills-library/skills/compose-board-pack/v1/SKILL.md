---
name: compose-board-pack
description: >
  Pull KPIs from CRM + iCal, draft narrative sections, render PDF via tenant brand template, score against rubric, hold for review.
tools:
  - fetch_ical
  - crm_list
  - generate_pdf
  - save_file
modules:
  - files
  - calendar
  - crm
files:
  - skill.mjs
version: 1.0.0
risk_class: medium                     # generates artefact for external review
invocation: both
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# compose-board-pack

Pull KPIs from CRM + iCal, draft narrative sections, render PDF via tenant brand template, score against rubric, hold for review.

## When to use

Scheduled monthly on the 1st. Also invokable conversationally ("monthly board pack", "examplecompany board pack"). Resolves {{tenant.brand}} + {{tenant.kpi_sources}} at run time.

## Contract

```javascript
import run from './skill.mjs'
const result = await run(input, ctx)
// ctx = { tool(name, args), mcp(tenant, tool, args), log, paths }
```

This skill **validates** that every required tool is present in `ctx` and that
required inputs are supplied. It **fails loudly** (throws) on missing tools or
inputs — it never fabricates data.

## Required tools

- `fetch_ical`
- `crm_list`
- `generate_pdf`
- `save_file`

## Required modules

- `files`
- `calendar`
- `crm`

## Returns

```json
{ "ok": true, "skill": "compose-board-pack", "steps": [ ... ] }
```
