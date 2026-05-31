---
name: triage-inbox
description: >
  For each new email in the active mailbox, classify (urgent/personal/business/admin/spam) and generate a proposed action. Surfaces in proposed_actions table; Telegram summary if any actions proposed.
tools:
  - ms365_list_messages
  - ms365_get_message
  - create_action
modules:
  - mail
files:
  - skill.mjs
version: 1.0.0
risk_class: medium                     # downstream tools may have side-effects
invocation: scheduled
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# triage-inbox

For each new email in the active mailbox, classify (urgent/personal/business/admin/spam) and generate a proposed action. Surfaces in proposed_actions table; Telegram summary if any actions proposed.

## When to use

Invoked automatically after each email poll (08:00 / 13:00 / 18:00 UK). Not invoked conversationally — manual trigger uses trigger_triage_pass tool.

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

- `ms365_list_messages`
- `ms365_get_message`
- `create_action`

## Required modules

- `mail`

## Returns

```json
{ "ok": true, "skill": "triage-inbox", "steps": [ ... ] }
```
