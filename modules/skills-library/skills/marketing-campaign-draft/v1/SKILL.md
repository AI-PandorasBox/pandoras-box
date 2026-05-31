---
name: marketing-campaign-draft
description: >
  Draft a multi-channel marketing campaign. Takes a brief (objective, audience, key message, channels). Produces per-channel artefacts (LinkedIn post, Mailchimp campaign, Meta post). Each artefact passes brand-voice rule -> Urania quality scoring -> if score in question-zone (5-7/10) the QIL Phase 6 loop generates clarifying questions for operator. Final artefacts land in drops/ for review before scheduling.
tools:
  - (none declared)
modules:
  - core
files:
  - skill.mjs
version: 1.0.0
risk_class: high
invocation: conversational
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# marketing-campaign-draft

Draft a multi-channel marketing campaign. Takes a brief (objective, audience, key message, channels). Produces per-channel artefacts (LinkedIn post, Mailchimp campaign, Meta post). Each artefact passes brand-voice rule -> Urania quality scoring -> if score in question-zone (5-7/10) the QIL Phase 6 loop generates clarifying questions for operator. Final artefacts land in drops/ for review before scheduling.

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

_none_

## Required modules

- `core`

## Returns

```json
{ "ok": true, "skill": "marketing-campaign-draft", "steps": [ ... ] }
```
