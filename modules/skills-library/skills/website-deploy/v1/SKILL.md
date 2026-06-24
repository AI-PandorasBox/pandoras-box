---
name: website-deploy
description: >
  Push a static / hybrid website build to its configured deploy target. Handles per-target adapter dispatch (FTP / SFTP / WebDAV / CDN), sitemap regen, cache bust. Returns a deploy receipt with rollback handle. Reusable across producers that need to publish a built site.
tools:
  - (none declared)
modules:
  - core
files:
  - skill.mjs
version: 1.0.0
risk_class: medium
invocation: conversational
author: Pandora's Box
guard: _SKILL_PROMOTED_V1
---

# website-deploy

Push a static / hybrid website build to its configured deploy target. Handles per-target adapter dispatch (FTP / SFTP / WebDAV / CDN), sitemap regen, cache bust. Returns a deploy receipt with rollback handle. Reusable across producers that need to publish a built site.

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
{ "ok": true, "skill": "website-deploy", "steps": [ ... ] }
```
