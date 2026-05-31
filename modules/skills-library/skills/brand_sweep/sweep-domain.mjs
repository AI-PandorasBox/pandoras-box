#!/usr/bin/env node
/**
 * sweep-domain.mjs — Domain availability sweep via RDAP
 * Part of $INSTALL_PATH/shared/skills/library/brand_sweep/
 *
 * Exports sweep(config) for module use.
 * CLI: DRY_RUN=false BRAND_NAME=example-brand node sweep-domain.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Approximate pricing (GBP) from typical UK registrars (Namecheap/Gandi/Cloudflare 2025-2026)
const DEFAULT_PRICE_TABLE = {
  'io':     { reg: 30,  renew: 30,  note: 'British Indian Ocean Territory ccTLD. Popular for tech.' },
  'studio': { reg: 24,  renew: 24,  note: 'Generic TLD. Popular for creative brands.' },
  'com':    { reg: 11,  renew: 13,  note: 'Gold standard. Highest authority.' },
  'co.uk':  { reg: 7,   renew: 9,   note: 'UK ccTLD. Preferred for UK-based consumer brands.' },
  'uk':     { reg: 7,   renew: 9,   note: 'Shorter UK ccTLD. Nominet registered.' },
  'net':    { reg: 11,  renew: 13,  note: 'Fallback if .com taken. Legacy tech connotations.' },
  'media':  { reg: 22,  renew: 22,  note: 'Niche TLD. Clear fit for publishing/content brand.' },
  'press':  { reg: 45,  renew: 45,  note: 'Niche TLD. Authoritative for press/news brands.' },
};

const PREFERENCE_ORDER = ['com', 'co.uk', 'io', 'studio', 'media', 'uk', 'net', 'press'];

function rdapUrl(fqdn) {
  return `https://rdap.org/domain/${fqdn}`;
}

async function checkDomain(fqdn) {
  const url = rdapUrl(fqdn);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/rdap+json, application/json' },
    });
    clearTimeout(timeout);
    if (res.status === 404) return { status: 'available', detail: 'RDAP 404 — no match' };
    if (res.status === 200) {
      const data = await res.json();
      const registrar = data.entities
        ?.find(e => e.roles?.includes('registrar'))
        ?.vcardArray?.[1]
        ?.find(v => v[0] === 'fn')?.[3] || 'unknown registrar';
      const expiryEvent = data.events?.find(e => e.eventAction === 'expiration');
      const expiry = expiryEvent?.eventDate?.split('T')[0] || 'unknown';
      return { status: 'taken', registrar, expiry, detail: `Expires ${expiry}, reg: ${registrar}` };
    }
    if (res.status === 429) return { status: 'rate-limited', detail: 'RDAP rate limited — retry later' };
    return { status: 'check-manually', detail: `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return { status: 'check-manually', detail: 'timeout' };
    return { status: 'check-manually', detail: err.message };
  }
}

function statusBadge(status) {
  switch (status) {
    case 'available':      return '✅ Available';
    case 'taken':          return '🔴 Taken';
    case 'rate-limited':   return '⏳ Rate limited';
    case 'check-manually': return '⚠️  Check manually';
    default:               return `? ${status}`;
  }
}

function recommendDomains(results, prefOrder) {
  const available = results.filter(r => r.result.status === 'available');
  return prefOrder.map(tld => available.find(r => r.tld === tld)).filter(Boolean);
}

function dryRunTemplate(brand_name, domains) {
  const lines = [
    `# Brand Domain Availability Sweep — ${brand_name}`,
    '',
    '> **DRY RUN** — no RDAP queries made. Preview of what will be checked.',
    `> Run with \`DRY_RUN=false\` to execute live sweep.`,
    '',
    `**Brand:** ${brand_name}  |  **Date:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Domains to check',
    '',
    '| Domain | RDAP Query URL | Est. Reg (£/yr) | Est. Renew (£/yr) |',
    '|--------|---------------|-----------------|-------------------|',
  ];
  for (const d of domains) {
    lines.push(`| ${d.fqdn} | ${rdapUrl(d.fqdn)} | £${d.reg} | £${d.renew} |`);
  }
  lines.push('', '---', '_Run with DRY_RUN=false to populate results._');
  return lines.join('\n');
}

async function liveSweep(domains) {
  const results = [];
  console.log(`[sweep-domain] Checking ${domains.length} domains via RDAP...`);
  for (const domain of domains) {
    process.stdout.write(`  ${domain.fqdn.padEnd(25)}`);
    const result = await checkDomain(domain.fqdn);
    results.push({ ...domain, result });
    console.log(statusBadge(result.status) + (result.detail ? ` — ${result.detail}` : ''));
    await new Promise(r => setTimeout(r, 1000));
  }
  return results;
}

function renderReport(brand_name, results, prefOrder) {
  const ranked = recommendDomains(results, prefOrder);
  const primary = ranked[0];
  const fallbacks = ranked.slice(1, 3);
  const lines = [
    `# Brand Domain Availability Sweep — ${brand_name}`,
    '',
    `**Brand:** ${brand_name}  |  **Date:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Results',
    '',
    '| Domain | Status | Reg £/yr | Renew £/yr | Notes |',
    '|--------|--------|----------|------------|-------|',
  ];
  for (const r of results) {
    const badge = statusBadge(r.result.status);
    const detail = r.result.detail || '';
    lines.push(`| ${r.fqdn} | ${badge} | £${r.reg} | £${r.renew} | ${r.note}${detail ? ' · ' + detail : ''} |`);
  }
  lines.push('', '## Recommendation', '');
  if (primary) {
    lines.push(`**Primary:** \`${primary.fqdn}\` — £${primary.reg}/yr registration, £${primary.renew}/yr renewal`);
    lines.push(`> ${primary.note}`, '');
    if (fallbacks.length > 0) {
      lines.push('**Fallbacks:**');
      for (const fb of fallbacks) {
        lines.push(`- \`${fb.fqdn}\` — £${fb.reg}/yr reg, £${fb.renew}/yr renewal`);
      }
    }
  } else {
    lines.push('No domains found available. Review manually or consider fallback brand name.');
  }
  lines.push('', '## Manual verification', '', '| Domain | Registrar check |', '|--------|----------------|');
  for (const r of results) {
    lines.push(`| ${r.fqdn} | https://www.namecheap.com/domains/registration/results/?domain=${r.fqdn} |`);
  }
  lines.push('', '---', `_Generated by sweep-domain.mjs at ${new Date().toISOString()}_`);
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function sweep(config = {}) {
  const brand_name = config.brand_name || process.env.BRAND_NAME || 'example-brand';
  const price_table = config.tlds || DEFAULT_PRICE_TABLE;
  const pref_order = config.pref_order || PREFERENCE_ORDER;
  const dry_run = config.dry_run ?? (process.env.DRY_RUN !== 'false');
  const output_dir = config.output_dir || resolve(__dirname, '../../');

  const domains = Object.keys(price_table).map(tld => ({
    tld,
    fqdn: `${brand_name}.${tld}`,
    ...price_table[tld],
  }));

  mkdirSync(output_dir, { recursive: true });
  const OUTPUT = resolve(output_dir, `${brand_name}-domain-sweep.md`);

  if (dry_run) {
    console.log('[sweep-domain] DRY_RUN=true — writing template report, no RDAP queries');
    writeFileSync(OUTPUT, dryRunTemplate(brand_name, domains), 'utf8');
    console.log(`[sweep-domain] Written: ${OUTPUT}`);
    return { output: OUTPUT, dry_run: true };
  }

  console.log('[sweep-domain] DRY_RUN=false — running live RDAP sweep');
  const results = await liveSweep(domains);
  writeFileSync(OUTPUT, renderReport(brand_name, results, pref_order), 'utf8');
  console.log(`\n[sweep-domain] Report written: ${OUTPUT}`);
  return { output: OUTPUT, dry_run: false };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sweep({}).catch(err => { console.error('[sweep-domain] FATAL:', err.message); process.exit(1); });
}
