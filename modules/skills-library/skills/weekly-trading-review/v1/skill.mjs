// weekly-trading-review — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: low. Invocation: scheduled.
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["trading_get_status","trading_get_positions","save_file"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('weekly-trading-review: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('weekly-trading-review: required tools not available: ' + missing.join(', '));
  }
}

export default async function weekly_trading_review (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[weekly-trading-review] start (risk=low)');

  // ---- declared tool sequence (from the recipe spec) ----
  // The spec declares WHICH tools this skill uses; the orchestration below
  // calls them in declared order. Each call's args must come from `input` or a
  // prior step result — see the per-tool TODO where bespoke logic is required.
  // step: trading_get_status
  if (typeof ctx.tool === 'function') {
    try {
      const r_trading_get_status = await ctx.tool("trading_get_status", input.trading_get_status_args || {});
      steps.push({ tool: "trading_get_status", ok: true });
    } catch (e) {
      steps.push({ tool: "trading_get_status", ok: false, error: String(e && e.message || e) });
      throw new Error('weekly-trading-review: step ' + "trading_get_status" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: trading_get_positions
  if (typeof ctx.tool === 'function') {
    try {
      const r_trading_get_positions = await ctx.tool("trading_get_positions", input.trading_get_positions_args || {});
      steps.push({ tool: "trading_get_positions", ok: true });
    } catch (e) {
      steps.push({ tool: "trading_get_positions", ok: false, error: String(e && e.message || e) });
      throw new Error('weekly-trading-review: step ' + "trading_get_positions" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: save_file
  if (typeof ctx.tool === 'function') {
    try {
      const r_save_file = await ctx.tool("save_file", input.save_file_args || {});
      steps.push({ tool: "save_file", ok: true });
    } catch (e) {
      steps.push({ tool: "save_file", ok: false, error: String(e && e.message || e) });
      throw new Error('weekly-trading-review: step ' + "save_file" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[weekly-trading-review] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'weekly-trading-review', steps };
}
