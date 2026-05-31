#!/usr/bin/env node
/**
 * action-plan.mjs — Reservation action plan synthesiser
 * Part of $INSTALL_PATH/shared/skills/library/brand_sweep/
 *
 * Reads outputs from the four sweep modules and produces an ordered action
 * plan for Ian. If sweeps are clean: domain → handles → TM filing (deferred).
 * If conflicts: surfaces Plan B suggestions.
 *
 * Exports run(config) for module use.
 * CLI: DRY_RUN=false BRAND_NAME=example-brand node action-plan.mjs
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parsers — read sweep markdown outputs ────────────────────────────────────

function readOutput(output_dir, filename) {
  const path = resolve(output_dir, filename);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function extractHandleSummary(md, brand_name) {
  if (!md) return { available: false, takenCount: null, platformSummary: '(no data)', needsFallback: false };
  const takenMatch = md.match(/Platforms taken[:\s]+(\d+)\s*\/\s*(\d+)/i);
  const takenCount = takenMatch ? parseInt(takenMatch[1]) : null;
  const totalCount = takenMatch ? parseInt(takenMatch[2]) : null;
  const needsFallback = md.includes('fallback sweep run') || (takenCount !== null && takenCount >= 2);
  const isDryRun = md.includes('DRY RUN');
  return { available: takenCount !== null ? takenCount < 2 : null, takenCount, totalCount, needsFallback, isDryRun };
}

function extractDomainRecommendation(md) {
  if (!md) return { primary: null, fallbacks: [], isDryRun: false };
  const isDryRun = md.includes('DRY RUN');
  const primaryMatch = md.match(/\*\*Primary:\*\*\s*`([^`]+)`/i);
  const primary = primaryMatch ? primaryMatch[1] : null;
  const fallbackMatches = [...md.matchAll(/^- `([^`]+)`/gm)];
  const fallbacks = fallbackMatches.map(m => m[1]).slice(0, 2);
  return { primary, fallbacks, isDryRun };
}

function extractTrademarkVerdict(md) {
  if (!md) return { verdict: null, isDryRun: false };
  const isDryRun = md.includes('DRY RUN');
  if (md.includes('Hard conflict')) return { verdict: 'hard-conflict', isDryRun };
  if (md.includes('Soft conflict')) return { verdict: 'soft-conflict', isDryRun };
  if (md.includes('Check manually')) return { verdict: 'check-manually', isDryRun };
  if (md.includes('Clean')) return { verdict: 'clean', isDryRun };
  return { verdict: null, isDryRun };
}

function extractBylineVerdict(md) {
  if (!md) return { verdict: null, isDryRun: false };
  const isDryRun = md.includes('DRY RUN');
  if (md.match(/Overall verdict.*No conflicts/i)) return { verdict: 'clean', isDryRun };
  if (md.match(/Overall verdict.*found — review/i)) return { verdict: 'conflict', isDryRun };
  if (md.match(/Overall verdict.*manually/i)) return { verdict: 'check-manually', isDryRun };
  if (md.includes('No other published authors named') && md.includes('clear for use')) return { verdict: 'clean', isDryRun };
  return { verdict: null, isDryRun };
}

function domainCost(tld) {
  const costs = { io: 30, studio: 24, com: 11, 'co.uk': 7, uk: 7, net: 11, media: 22, press: 45 };
  return costs[tld] || '?';
}

function buildPlanB(brand_name) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    { name: `${cap(brand_name)} Studio`, handles: `@${brand_name}studio`, domain: `${brand_name}studio.com / .studio`, note: 'Studio suffix. Suggests creative/production house.' },
    { name: `${cap(brand_name)} Media`,  handles: `@${brand_name}media`,  domain: `${brand_name}media.com / .media`,  note: 'Media suffix. Clear fit for publishing/content brand.' },
    { name: `${cap(brand_name)} Cycle`,  handles: `@${brand_name}cycle`,  domain: `${brand_name}cycle.com / .co.uk`,  note: 'Cycle suffix. Adds genre context.' },
    { name: `${cap(brand_name)} Press`,  handles: `@${brand_name}press`,  domain: `${brand_name}press.com / .press`,  note: 'Press suffix. Authoritative for publishing brands.' },
  ];
}

// ── Report builders ───────────────────────────────────────────────────────────

function dryRunTemplate(brand_name, byline) {
  const date = new Date().toISOString().split('T')[0];
  const planB = buildPlanB(brand_name);
  const lines = [
    `# Brand Reservation Action Plan — ${brand_name}`,
    '',
    `> **DRY RUN** — tasks 001-004 have not been run yet. This is the action plan template.`,
    `> Run sweeps with DRY_RUN=false, then re-run this script to get the tailored plan.`,
    '',
    `**Brand:** ${brand_name}  |  **Byline:** ${byline}  |  **Date:** ${date}`,
    '',
    '## Plan logic',
    '',
    '| Condition | Action |',
    '|-----------|--------|',
    `| @${brand_name} available on ≥6/8 platforms | Proceed with primary name |`,
    `| @${brand_name} taken on ≥2 platforms | Use fallback handle |`,
    '| Preferred domain available | Register first (~£7-30/yr) |',
    '| Trademark: clean | Proceed to filing (~£200/class, deferred) |',
    '| Trademark: soft conflict | Consult attorney, proceed with caution |',
    '| Trademark: hard conflict | Switch to Plan B name |',
    `| Byline: clean | Use "${byline}" as stated |`,
    '| Byline: conflict | Consider middle initial or pen name variant |',
    '',
    '## If all sweeps clean — action sequence',
    '',
    '1. **Register primary domain** (within 48 hours of sweep confirmation)',
    '2. **Reserve handles** — all under same email, free',
    '3. **Purchase 1-2 fallback domains** (same session as primary)',
    '4. **Trademark filing — deferred** (~£200/class via UK IPO)',
    `5. **Byline** — "${byline}" locked`,
    '',
    '## Plan B names (if primary blocked)',
    '',
    '| Candidate | Handles | Domains | Notes |',
    '|-----------|---------|---------|-------|',
  ];
  for (const p of planB) lines.push(`| ${p.name} | ${p.handles} | ${p.domain} | ${p.note} |`);
  lines.push('', '---', '_Run with DRY_RUN=false (after sweeps complete) for tailored plan._');
  return lines.join('\n');
}

function renderLivePlan(brand_name, byline, { handleSummary, domainRec, tmVerdict, bylineVerdict }) {
  const date = new Date().toISOString().split('T')[0];
  const missingData = [handleSummary, domainRec, tmVerdict, bylineVerdict].some(r => !r || r.isDryRun);
  const planB = buildPlanB(brand_name);
  const lines = [`# Brand Reservation Action Plan — ${brand_name}`, '', `**Brand:** ${brand_name}  |  **Byline:** ${byline}  |  **Date:** ${date}`, ''];

  if (missingData) {
    lines.push('> **Warning:** Some task outputs are missing or are dry-run templates. Re-run sweeps with DRY_RUN=false for a fully tailored plan.', '');
  }

  lines.push('## Sweep summary', '', '| Check | Result |', '|-------|--------|');
  const handleStatus = handleSummary?.isDryRun ? '_(not yet run)_'
    : handleSummary?.needsFallback ? `⚠️ @${brand_name} taken on ${handleSummary.takenCount} platforms — fallback needed`
    : `✅ @${brand_name} available (taken ${handleSummary?.takenCount ?? 0}/${handleSummary?.totalCount ?? 8})`;
  lines.push(`| Handle sweep | ${handleStatus} |`);
  const domainStatus = domainRec?.isDryRun ? '_(not yet run)_' : domainRec?.primary ? `✅ Recommended: \`${domainRec.primary}\`` : '⚠️ Check manually';
  lines.push(`| Domain sweep | ${domainStatus} |`);
  const tmStatus = tmVerdict?.isDryRun ? '_(not yet run)_' : !tmVerdict?.verdict ? '⚠️ Check manually' : tmVerdict.verdict === 'clean' ? '✅ Clean — all classes' : tmVerdict.verdict === 'soft-conflict' ? '⚠️ Soft conflict — review' : '🔴 Hard conflict — seek legal advice';
  lines.push(`| Trademark check | ${tmStatus} |`);
  const bylineStatus = bylineVerdict?.isDryRun ? '_(not yet run)_' : !bylineVerdict?.verdict ? '⚠️ Check manually' : bylineVerdict.verdict === 'clean' ? '✅ No conflicts found' : '⚠️ Existing authors found — review';
  lines.push(`| Byline check | ${bylineStatus} |`, '');

  const primaryBlocked = handleSummary?.needsFallback || tmVerdict?.verdict === 'hard-conflict';

  if (!primaryBlocked) {
    lines.push(`## Action sequence — Primary brand: ${brand_name}`, '', 'All checks support proceeding with the primary brand:', '');
    let step = 1;
    if (domainRec?.primary) {
      const tld = domainRec.primary.split('.').slice(1).join('.');
      lines.push(`**Step ${step++}. Register primary domain** (\`${domainRec.primary}\`) — ~£${domainCost(tld)}/yr`);
      lines.push(`   - Registrar: [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (at-cost) or [Namecheap](https://www.namecheap.com)`);
      if (domainRec.fallbacks?.length > 0) lines.push(`   - Fallback domains: ${domainRec.fallbacks.map(d => `\`${d}\``).join(', ')}`);
      lines.push('');
    }
    lines.push(`**Step ${step++}. Reserve social handles** — all free, same email`);
    lines.push(`   Reserve @${brand_name} on: YouTube → Instagram → TikTok → X → Threads → Bluesky → Mastodon`, '');
    lines.push(`**Step ${step++}. Trademark filing — DEFERRED**`);
    const tmNote = tmVerdict?.verdict === 'soft-conflict' ? '   - ⚠️ Soft conflict found — consult a UK trademark attorney before filing' : '   - Sweeps clean — straightforward filing expected';
    lines.push(tmNote);
    lines.push('   - File class 16 (publishing) first: ~£200/class via UK IPO');
    lines.push('   - File class 41 (entertainment) closer to first publication', '');
    lines.push(`**Step ${step++}. Confirm byline**`);
    if (bylineVerdict?.verdict === 'conflict') {
      lines.push(`   - ⚠️ Other authors named "${byline}" found — review byline report`);
      const parts = byline.split(' ');
      lines.push(`   - Consider "${parts[0]} J. ${parts.slice(1).join(' ')}" to differentiate`);
    } else {
      lines.push(`   - Byline: **"${byline}"** — no conflicting authors found`);
    }
    lines.push('');
  } else {
    lines.push('## Action sequence — Plan B required', '', `Primary brand "@${brand_name}" faces conflicts. Recommended Plan B candidates:`, '');
    lines.push('| Candidate | Handles | Domains | Notes |', '|-----------|---------|---------|-------|');
    for (const p of planB) lines.push(`| **${p.name}** | ${p.handles} | ${p.domain} | ${p.note} |`);
    lines.push('', `**Ian must select a Plan B name.** Once selected, re-run sweeps for the chosen name before proceeding.`, '');
  }

  lines.push('## Cost summary', '', '| Item | Cost | Timing |', '|------|------|--------|');
  if (domainRec?.primary) {
    const tld = domainRec.primary.split('.').slice(1).join('.');
    lines.push(`| Primary domain (${domainRec.primary}) | ~£${domainCost(tld)}/yr | Now |`);
  } else {
    lines.push('| Primary domain | ~£7-30/yr | Now |');
  }
  lines.push('| Social handles (all 7-8) | Free | Now |');
  lines.push('| TM filing class 16 | ~£200 | Deferred |');
  lines.push('| TM filing class 41 | ~£200 | Deferred |', '');
  lines.push('---', `_Generated by action-plan.mjs at ${new Date().toISOString()}_`);
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function run(config = {}) {
  const brand_name = config.brand_name || process.env.BRAND_NAME || 'example-brand';
  const byline = config.byline || process.env.BYLINE || 'Your Name';
  const dry_run = config.dry_run ?? (process.env.DRY_RUN !== 'false');
  const output_dir = config.output_dir || resolve(__dirname, '../../');

  mkdirSync(output_dir, { recursive: true });
  const OUTPUT = resolve(output_dir, `${brand_name}-action-plan.md`);

  if (dry_run) {
    console.log('[action-plan] DRY_RUN=true — writing template action plan');
    writeFileSync(OUTPUT, dryRunTemplate(brand_name, byline), 'utf8');
    console.log(`[action-plan] Written: ${OUTPUT}`);
    return { output: OUTPUT, dry_run: true };
  }

  console.log('[action-plan] DRY_RUN=false — reading sweep outputs and generating tailored plan');

  const handleMd = readOutput(output_dir, `${brand_name}-handle-sweep.md`);
  const domainMd = readOutput(output_dir, `${brand_name}-domain-sweep.md`);
  const tmMd = readOutput(output_dir, `${brand_name}-trademark.md`);
  const bylineMd = readOutput(output_dir, `${brand_name}-byline.md`);

  const missing = [];
  if (!handleMd) missing.push(`${brand_name}-handle-sweep.md`);
  if (!domainMd) missing.push(`${brand_name}-domain-sweep.md`);
  if (!tmMd) missing.push(`${brand_name}-trademark.md`);
  if (!bylineMd) missing.push(`${brand_name}-byline.md`);
  if (missing.length > 0) {
    console.warn(`[action-plan] WARNING: missing sweep outputs: ${missing.join(', ')}`);
    console.warn('[action-plan] Generating partial plan — run missing sweeps first for full result');
  }

  const handleSummary = extractHandleSummary(handleMd, brand_name);
  const domainRec = extractDomainRecommendation(domainMd);
  const tmVerdict = extractTrademarkVerdict(tmMd);
  const bylineVerdict = extractBylineVerdict(bylineMd);

  writeFileSync(OUTPUT, renderLivePlan(brand_name, byline, { handleSummary, domainRec, tmVerdict, bylineVerdict }), 'utf8');
  console.log(`[action-plan] Report written: ${OUTPUT}`);
  return { output: OUTPUT, dry_run: false };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run({}).catch(err => { console.error('[action-plan] FATAL:', err.message); process.exit(1); });
}
