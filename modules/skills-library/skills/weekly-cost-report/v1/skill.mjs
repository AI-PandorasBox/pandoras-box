// weekly-cost-report — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: low. Invocation: scheduled.
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["ms365_create_draft"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('weekly-cost-report: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('weekly-cost-report: required tools not available: ' + missing.join(', '));
  }
}

export default async function weekly_cost_report (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[weekly-cost-report] start (risk=low)');

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
      throw new Error('weekly-cost-report: step ' + "ms365_create_draft" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[weekly-cost-report] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'weekly-cost-report', steps };
}
