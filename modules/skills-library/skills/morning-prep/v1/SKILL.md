---
name: morning-prep
description: >
  Pre-generate daily briefing — stock watchlist, weather, calendar overview, inbox summary. Available on first assistant tab open.
tools:
  - (none declared)
modules:
  - mail
  - calendar
  - research
files:
  - skill.mjs
version: 1.0.0
risk_class: low
invocation: scheduled
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# morning-prep

Pre-generate daily briefing — stock watchlist, weather, calendar overview, inbox summary. Available on first assistant tab open.

## When to use

Scheduled at 07:30 weekdays. Skipped on Sat/Sun per weekend gate.

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

_none_

## Required modules

- `mail`
- `calendar`
- `research`

## Returns

```json
{ "ok": true, "skill": "morning-prep", "steps": [ ... ] }
```
