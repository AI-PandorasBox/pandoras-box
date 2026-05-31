---
name: weekly-cost-report
description: >
  Sum Mon–Sun API cost from api_usage_log, format as markdown, send to the owner.
tools:
  - ms365_create_draft
modules:
  - mail
  - summaries
files:
  - skill.mjs
version: 1.0.0
risk_class: low
invocation: scheduled
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# weekly-cost-report

Sum Mon–Sun API cost from api_usage_log, format as markdown, send to the owner.

## When to use

Sends weekly Mon–Sun summary email each Monday at 08:00.

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

- `ms365_create_draft`

## Required modules

- `mail`
- `summaries`

## Returns

```json
{ "ok": true, "skill": "weekly-cost-report", "steps": [ ... ] }
```
