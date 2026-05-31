---
name: marketing-channel-post
description: >
  Schedule or publish a previously-drafted marketing artefact to its channel. Takes an artefact id (from marketing-campaign-draft output). Verifies brand-voice + rate-limit policy + 5-minute review window. Schedules via the channel API. Publish-step is gated by a mandatory human-review countdown -- if scheduled_at minus now is less than 5 minutes, Argus refuses.
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

# marketing-channel-post

Schedule or publish a previously-drafted marketing artefact to its channel. Takes an artefact id (from marketing-campaign-draft output). Verifies brand-voice + rate-limit policy + 5-minute review window. Schedules via the channel API. Publish-step is gated by a mandatory human-review countdown -- if scheduled_at minus now is less than 5 minutes, Argus refuses.

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
{ "ok": true, "skill": "marketing-channel-post", "steps": [ ... ] }
```
