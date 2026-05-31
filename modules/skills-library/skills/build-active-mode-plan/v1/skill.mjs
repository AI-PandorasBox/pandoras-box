// build-active-mode-plan — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: low. Invocation: scheduled.
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["fetch_ical","ms365_list_events"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('build-active-mode-plan: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('build-active-mode-plan: required tools not available: ' + missing.join(', '));
  }
}

export default async function build_active_mode_plan (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[build-active-mode-plan] start (risk=low)');

  // ---- declared tool sequence (from the recipe spec) ----
  // The spec declares WHICH tools this skill uses; the orchestration below
  // calls them in declared order. Each call's args must come from `input` or a
  // prior step result — see the per-tool TODO where bespoke logic is required.
  // step: fetch_ical
  if (typeof ctx.tool === 'function') {
    try {
      const r_fetch_ical = await ctx.tool("fetch_ical", input.fetch_ical_args || {});
      steps.push({ tool: "fetch_ical", ok: true });
    } catch (e) {
      steps.push({ tool: "fetch_ical", ok: false, error: String(e && e.message || e) });
      throw new Error('build-active-mode-plan: step ' + "fetch_ical" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: ms365_list_events
  if (typeof ctx.tool === 'function') {
    try {
      const r_ms365_list_events = await ctx.tool("ms365_list_events", input.ms365_list_events_args || {});
      steps.push({ tool: "ms365_list_events", ok: true });
    } catch (e) {
      steps.push({ tool: "ms365_list_events", ok: false, error: String(e && e.message || e) });
      throw new Error('build-active-mode-plan: step ' + "ms365_list_events" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[build-active-mode-plan] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'build-active-mode-plan', steps };
}
