---
name: onboard-new-client
description: >
  Sequence — create client folder, draft welcome email, schedule kickoff, file paperwork. Tenant-scoped per activation.
tools:
  - ms365_create_draft
  - ms365_create_event
  - save_file
  - crm_create_item
modules:
  - mail
  - calendar
  - files
  - crm
files:
  - skill.mjs
version: 1.0.0
risk_class: medium                     # creates / drafts / schedules; downstream side-effects
invocation: conversational
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# onboard-new-client

Sequence — create client folder, draft welcome email, schedule kickoff, file paperwork. Tenant-scoped per activation.

## When to use

Invoke when the owner says "new client signed: <name>" or similar phrasing. Resolves {{tenant.id}} + {{tenant.brand}} at run time so the same Skill works for any tenant supplying the right config.

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
- `ms365_create_event`
- `save_file`
- `crm_create_item`

## Required modules

- `mail`
- `calendar`
- `files`
- `crm`

## Returns

```json
{ "ok": true, "skill": "onboard-new-client", "steps": [ ... ] }
```
