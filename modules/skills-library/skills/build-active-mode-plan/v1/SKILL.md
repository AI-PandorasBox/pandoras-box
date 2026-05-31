---
name: build-active-mode-plan
description: >
  Read next 48h of calendar, ask Haiku for a JSON push schedule, write to active-mode-plan.json.
tools:
  - fetch_ical
  - ms365_list_events
modules:
  - calendar
  - active-mode
files:
  - skill.mjs
version: 1.0.0
risk_class: low
invocation: scheduled
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# build-active-mode-plan

Read next 48h of calendar, ask Haiku for a JSON push schedule, write to active-mode-plan.json.

## When to use

Triggered by Melete tick when active-mode-plan.json is stale (last_plan_built more than plan_refresh_hours ago).

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
- `ms365_list_events`

## Required modules

- `calendar`
- `active-mode`

## Returns

```json
{ "ok": true, "skill": "build-active-mode-plan", "steps": [ ... ] }
```
