---
name: proactive-triage
description: >
  Active Mode triage variant. Runs more frequently than triage-inbox, takes broader autonomous action within bounds, pushes due-now items to watch companion.
tools:
  - (none declared)
modules:
  - mail
  - calendar
  - watchmuse
  - triage-actions
  - active-mode
files:
  - skill.mjs
version: 1.0.0
risk_class: high                       # broader autonomous action; canary required
invocation: scheduled
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# proactive-triage

Active Mode triage variant. Runs more frequently than triage-inbox, takes broader autonomous action within bounds, pushes due-now items to watch companion.

## When to use

Loaded only when active-mode Module is active. Runs at higher frequency than default triage-inbox. Bounded by active-mode-action-thresholds policy and active-mode-rate-limits policy. Hard kill switch: deactivate active-mode Module.

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
- `watchmuse`
- `triage-actions`
- `active-mode`

## Returns

```json
{ "ok": true, "skill": "proactive-triage", "steps": [ ... ] }
```
