// compose-board-pack — packaged skill (promoted from recipe spec) _SKILL_PROMOTED_V1
// Contract: export default async function (input, ctx)
//   ctx.tool(name, args)  -> call a native personal-ai tool
//   ctx.mcp(tenant, tool, args) -> call an MCP tool
//   ctx.log(msg)          -> progress log
//   ctx.paths             -> { skillDir, runsDir }
// Risk: medium                     # generates artefact for external review. Invocation: both.
//
// Data-integrity rule: this skill NEVER invents values. Every output field is
// derived from a real tool result or a supplied input. Missing -> throw.

export const REQUIRED_TOOLS = ["fetch_ical","crm_list","generate_pdf","save_file"];

function assertCtx (ctx) {
  if (!ctx || typeof ctx.tool !== 'function') {
    throw new Error('compose-board-pack: ctx.tool(name,args) is required');
  }
  const missing = REQUIRED_TOOLS.filter(t => ctx.available && !ctx.available.includes(t));
  if (ctx.available && missing.length) {
    throw new Error('compose-board-pack: required tools not available: ' + missing.join(', '));
  }
}

export default async function compose_board_pack (input = {}, ctx = {}) {
  assertCtx(ctx);
  const log = ctx.log || (() => {});
  const steps = [];
  log('[compose-board-pack] start (risk=medium                     # generates artefact for external review)');

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
      throw new Error('compose-board-pack: step ' + "fetch_ical" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: crm_list
  if (typeof ctx.tool === 'function') {
    try {
      const r_crm_list = await ctx.tool("crm_list", input.crm_list_args || {});
      steps.push({ tool: "crm_list", ok: true });
    } catch (e) {
      steps.push({ tool: "crm_list", ok: false, error: String(e && e.message || e) });
      throw new Error('compose-board-pack: step ' + "crm_list" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: generate_pdf
  if (typeof ctx.tool === 'function') {
    try {
      const r_generate_pdf = await ctx.tool("generate_pdf", input.generate_pdf_args || {});
      steps.push({ tool: "generate_pdf", ok: true });
    } catch (e) {
      steps.push({ tool: "generate_pdf", ok: false, error: String(e && e.message || e) });
      throw new Error('compose-board-pack: step ' + "generate_pdf" + ' failed: ' + (e && e.message || e));
    }
  }
  // step: save_file
  if (typeof ctx.tool === 'function') {
    try {
      const r_save_file = await ctx.tool("save_file", input.save_file_args || {});
      steps.push({ tool: "save_file", ok: true });
    } catch (e) {
      steps.push({ tool: "save_file", ok: false, error: String(e && e.message || e) });
      throw new Error('compose-board-pack: step ' + "save_file" + ' failed: ' + (e && e.message || e));
    }
  }

  log('[compose-board-pack] done — ' + steps.length + ' steps');
  return { ok: true, skill: 'compose-board-pack', steps };
}
