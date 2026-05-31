---
name: youtube-upload-and-monitor
description: >
  Drives a single YouTube upload from local video file -> scheduled publish -> live -> metrics polling. Encapsulates the full lifecycle so consumers (mediapipeline today, Autonomy persona future) can dispatch as one Skill rather than orchestrating individual tool calls.
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

# youtube-upload-and-monitor

Drives a single YouTube upload from local video file -> scheduled publish -> live -> metrics polling. Encapsulates the full lifecycle so consumers (mediapipeline today, Autonomy persona future) can dispatch as one Skill rather than orchestrating individual tool calls.

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
{ "ok": true, "skill": "youtube-upload-and-monitor", "steps": [ ... ] }
```
