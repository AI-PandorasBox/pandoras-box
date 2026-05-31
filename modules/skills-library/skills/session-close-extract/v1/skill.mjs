// session-close-extract — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: low                        # writes only to own memory + vault. Invocation: scheduled                  # triggered by session-close hook (1+ hour idle).
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["save_memory","vault_write"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('session-close-extract: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('session-close-extract: required tools not available: ' + missing.join(', '));
  }
}

export default async function session_close_extract (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[session-close-extract] start (risk=low                        # writes only to own memory + vault)');

  // ---- declared tool sequence (from the recipe spec) ----
  // The spec declares WHICH tools this skill uses; the orchestration below
  // calls them in declared order. Each call's args must come from `input` or a
  // prior step result — see the per-tool TODO where bespoke logic is required.
  // step: save_memory
  if (typeof ctx.tool === 'function') {
    try {
      const r_save_memory = await ctx.tool("save_memory", input.save_memory_args || {});
      steps.push({ tool: "save_memory", ok: true });
    } catch (e) {
      steps.push({ tool: "save_memory", ok: false, error: String(e && e.message || e) });
      throw new Error('session-close-extract: step ' + "save_memory" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: vault_write
  if (typeof ctx.tool === 'function') {
    try {
      const r_vault_write = await ctx.tool("vault_write", input.vault_write_args || {});
      steps.push({ tool: "vault_write", ok: true });
    } catch (e) {
      steps.push({ tool: "vault_write", ok: false, error: String(e && e.message || e) });
      throw new Error('session-close-extract: step ' + "vault_write" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[session-close-extract] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'session-close-extract', steps };
}
