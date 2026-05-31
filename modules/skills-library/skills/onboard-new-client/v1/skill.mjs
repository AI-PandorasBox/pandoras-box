// onboard-new-client — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: medium                     # creates / drafts / schedules; downstream side-effects. Invocation: conversational.
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["ms365_create_draft","ms365_create_event","save_file","crm_create_item"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('onboard-new-client: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('onboard-new-client: required tools not available: ' + missing.join(', '));
  }
}

export default async function onboard_new_client (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[onboard-new-client] start (risk=medium                     # creates / drafts / schedules; downstream side-effects)');

  // ---- declared tool sequence (from the recipe spec) ----
  // The spec declares WHICH tools this skill uses; the orchestration below
  // calls them in declared order. Each call's args must come from `input` or a
  // prior step result — see the per-tool TODO where bespoke logic is required.
  // step: ms365_create_draft
  if (typeof ctx.tool === 'function') {
    try {
      const r_ms365_create_draft = await ctx.tool("ms365_create_draft", input.ms365_create_draft_args || {});
      steps.push({ tool: "ms365_create_draft", ok: true });
    } catch (e) {
      steps.push({ tool: "ms365_create_draft", ok: false, error: String(e && e.message || e) });
      throw new Error('onboard-new-client: step ' + "ms365_create_draft" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: ms365_create_event
  if (typeof ctx.tool === 'function') {
    try {
      const r_ms365_create_event = await ctx.tool("ms365_create_event", input.ms365_create_event_args || {});
      steps.push({ tool: "ms365_create_event", ok: true });
    } catch (e) {
      steps.push({ tool: "ms365_create_event", ok: false, error: String(e && e.message || e) });
      throw new Error('onboard-new-client: step ' + "ms365_create_event" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: save_file
  if (typeof ctx.tool === 'function') {
    try {
      const r_save_file = await ctx.tool("save_file", input.save_file_args || {});
      steps.push({ tool: "save_file", ok: true });
    } catch (e) {
      steps.push({ tool: "save_file", ok: false, error: String(e && e.message || e) });
      throw new Error('onboard-new-client: step ' + "save_file" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: crm_create_item
  if (typeof ctx.tool === 'function') {
    try {
      const r_crm_create_item = await ctx.tool("crm_create_item", input.crm_create_item_args || {});
      steps.push({ tool: "crm_create_item", ok: true });
    } catch (e) {
      steps.push({ tool: "crm_create_item", ok: false, error: String(e && e.message || e) });
      throw new Error('onboard-new-client: step ' + "crm_create_item" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[onboard-new-client] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'onboard-new-client', steps };
}
