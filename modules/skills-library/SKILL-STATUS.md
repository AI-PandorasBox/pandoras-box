# Packaged skill status on a stock public box

Verified by running each packaged skill through the personal-ai `run_skill` path against
the now-shipped box-safe executors (48 tools). `run_skill` exposes `ctx.tool(name,args)`
resolving to the executor layer, and `ctx.available` = the offered tool names, so skills
that declare `REQUIRED_TOOLS` gate correctly. _PUBLIC_SKILLS_VERIFIED_V1

## Runs on a stock box (7)

These complete (or reach their own input gate) using only box-safe executors:

| Skill | Notes |
|---|---|
| session-close-extract | **was dead-on-arrival** in the audit (needed `save_memory` + `vault_write`); both now ship, so it runs |
| marketing-campaign-draft | prompt/self-contained |
| marketing-channel-post | prompt/self-contained |
| morning-prep | prompt/self-contained |
| proactive-triage | prompt/self-contained |
| website-deploy | prompt/self-contained |
| youtube-upload-and-monitor | lifecycle/self-contained at the run_skill boundary |

## Requires EXCLUDED tools — fails honestly at the gate, NOT faked (7)

These need multi-tenant MS365, CRM, or trading tools that are deliberately excluded from
the public box (see `personal-ai/SHIPPED-TOOLS.md`). They now fail with a clear "required
tools not available: ..." message instead of crashing, but they cannot complete without
the user wiring those capabilities themselves.

| Skill | Excluded tool(s) it needs |
|---|---|
| build-active-mode-plan | `ms365_list_events` |
| build_board_pack_from_calendar | `get-calendar-view` (MS365) + optional dep `exceljs` + Chrome |
| compose-board-pack | `crm_list`, `fetch_ical`*, `generate_pdf` (fetch_ical + generate_pdf DO ship; `crm_list` is excluded) |
| onboard-new-client | `ms365_create_draft`, `ms365_create_event`, `crm_create_item` |
| triage-inbox | `ms365_list_messages`, `ms365_get_message`, `create_action` |
| weekly-cost-report | `ms365_create_draft` |
| weekly-trading-review | `trading_get_positions`, `trading_get_status` |

## Tool-wiring fix applied (in scope: skill.mjs only, not SKILL.md prose)

`build_board_pack_from_calendar/skill.mjs`:
- `exceljs` require made **lazy** (was a top-level `createRequire` against a hardcoded
  `/opt/pandoras-box/...` path that crashed the import on any box without exceljs,
  masking the honest "needs MS365 + exceljs + Chrome" outcome).
- Added a `default` export adapter so `run_skill` can invoke it (it previously only
  exported `buildBoardPack`, making it un-invokable via run_skill). The adapter routes
  the legacy `getTenant().callTool('get-calendar-view')` calls through the box-safe tool
  surface, which honestly returns "non-executable tool" on a box with no MS365 tenant.
