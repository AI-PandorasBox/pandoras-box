---
name: session-close-extract
description: >
  At session close, extract structured data from the conversation transcript — commitments, people, decisions, open threads, vault updates.
tools:
  - save_memory
  - vault_write
modules:
  - vault-graph
files:
  - skill.mjs
version: 1.0.0
risk_class: low                        # writes only to own memory + vault
invocation: scheduled                  # triggered by session-close hook (1+ hour idle)
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# session-close-extract

At session close, extract structured data from the conversation transcript — commitments, people, decisions, open threads, vault updates.

## When to use

Fires automatically when a session has been idle for 1+ hours. Extracts structured data, writes to vault + memory, then deletes raw chat history.

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

- `save_memory`
- `vault_write`

## Required modules

- `vault-graph`

## Returns

```json
{ "ok": true, "skill": "session-close-extract", "steps": [ ... ] }
```
