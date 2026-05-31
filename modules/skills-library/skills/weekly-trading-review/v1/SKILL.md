---
name: weekly-trading-review
description: >
  Aggregate trading-agent's last 7 days, summarise to markdown, save to drops, send notification.
tools:
  - trading_get_status
  - trading_get_positions
  - save_file
modules:
  - files
files:
  - skill.mjs
version: 1.0.0
risk_class: low
invocation: scheduled
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# weekly-trading-review

Aggregate trading-agent's last 7 days, summarise to markdown, save to drops, send notification.

## When to use

(see description)

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

- `trading_get_status`
- `trading_get_positions`
- `save_file`

## Required modules

- `files`

## Returns

```json
{ "ok": true, "skill": "weekly-trading-review", "steps": [ ... ] }
```
