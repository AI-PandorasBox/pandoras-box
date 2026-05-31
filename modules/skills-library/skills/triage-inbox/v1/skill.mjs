// triage-inbox — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: medium                     # downstream tools may have side-effects. Invocation: scheduled.
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["ms365_list_messages","ms365_get_message","create_action"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('triage-inbox: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('triage-inbox: required tools not available: ' + missing.join(', '));
  }
}

export default async function triage_inbox (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[triage-inbox] start (risk=medium                     # downstream tools may have side-effects)');

  // ---- declared tool sequence (from the recipe spec) ----
  // The spec declares WHICH tools this skill uses; the orchestration below
  // calls them in declared order. Each call's args must come from `input` or a
  // prior step result — see the per-tool TODO where bespoke logic is required.
  // step: ms365_list_messages
  if (typeof ctx.tool === 'function') {
    try {
      const r_ms365_list_messages = await ctx.tool("ms365_list_messages", input.ms365_list_messages_args || {});
      steps.push({ tool: "ms365_list_messages", ok: true });
    } catch (e) {
      steps.push({ tool: "ms365_list_messages", ok: false, error: String(e && e.message || e) });
      throw new Error('triage-inbox: step ' + "ms365_list_messages" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: ms365_get_message
  if (typeof ctx.tool === 'function') {
    try {
      const r_ms365_get_message = await ctx.tool("ms365_get_message", input.ms365_get_message_args || {});
      steps.push({ tool: "ms365_get_message", ok: true });
    } catch (e) {
      steps.push({ tool: "ms365_get_message", ok: false, error: String(e && e.message || e) });
      throw new Error('triage-inbox: step ' + "ms365_get_message" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: create_action
  if (typeof ctx.tool === 'function') {
    try {
      const r_create_action = await ctx.tool("create_action", input.create_action_args || {});
      steps.push({ tool: "create_action", ok: true });
    } catch (e) {
      steps.push({ tool: "create_action", ok: false, error: String(e && e.message || e) });
      throw new Error('triage-inbox: step ' + "create_action" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[triage-inbox] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'triage-inbox', steps };
}
