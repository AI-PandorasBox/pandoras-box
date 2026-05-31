#!/usr/bin/env node
/**
 * sweep-handle.mjs — Social handle availability sweep
 * Part of $INSTALL_PATH/shared/skills/library/brand_sweep/
 *
 * Exports sweep(config) for module use.
 * CLI: DRY_RUN=false BRAND_NAME=example-brand node sweep-handle.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PLATFORMS = [
  {
    name: 'YouTube',
    handle: h => `@${h}`,
    profileUrl: h => `https://www.youtube.com/@${h}`,
    checkUrl: h => `https://www.youtube.com/@${h}`,
    checkMethod: 'http-status',
    note: 'YT Shorts uses same channel — no separate handle needed',
  },
  {
    name: 'YT Shorts',
    handle: h => `@${h}`,
    profileUrl: h => `https://www.youtube.com/@${h}`,
    checkUrl: null,
    checkMethod: 'derived',
    note: 'Same as YouTube channel — check YouTube result',
  },
  {
    name: 'Instagram',
    handle: h => `@${h}`,
    profileUrl: h => `https://www.instagram.com/${h}/`,
    checkUrl: h => `https://www.instagram.com/${h}/`,
    checkMethod: 'http-status',
    note: 'May require login to view — result may read as taken even if profile page redirects',
  },
  {
    name: 'TikTok',
    handle: h => `@${h}`,
    profileUrl: h => `https://www.tiktok.com/@${h}`,
    checkUrl: h => `https://www.tiktok.com/@${h}`,
    checkMethod: 'http-status',
    note: null,
  },
  {
    name: 'X (Twitter)',
    handle: h => `@${h}`,
    profileUrl: h => `https://x.com/${h}`,
    checkUrl: h => `https://x.com/${h}`,
    checkMethod: 'http-status',
    note: 'X may require login to view profiles — verify manually',
  },
  {
    name: 'Threads',
    handle: h => `@${h}`,
    profileUrl: h => `https://www.threads.net/@${h}`,
    checkUrl: h => `https://www.threads.net/@${h}`,
    checkMethod: 'http-status',
    note: null,
  },
  {
    name: 'Bluesky',
    handle: h => `${h}.bsky.social`,
    profileUrl: h => `https://bsky.app/profile/${h}.bsky.social`,
    checkUrl: h => `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${h}.bsky.social`,
    checkMethod: 'api-json',
    apiAvailableKey: 'did',
    note: 'Uses AT Protocol identity resolution API — reliable',
  },
  {
    name: 'Mastodon (mastodon.social)',
    handle: h => `@${h}@mastodon.social`,
    profileUrl: h => `https://mastodon.social/@${h}`,
    checkUrl: h => `https://mastodon.social/api/v1/accounts/lookup?acct=${h}`,
    checkMethod: 'api-json',
    apiAvailableKey: 'id',
    note: 'Checks mastodon.social instance only — handle may be free on other instances',
  },
];

async function checkPlatform(platform, handle) {
  if (platform.checkMethod === 'derived') {
    return { status: 'derived', detail: platform.note };
  }
  const url = platform.checkUrl(handle);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; brand-sweep/1.0; +research)',
        'Accept': 'text/html,application/json,*/*',
      },
    });
    clearTimeout(timeout);
    if (platform.checkMethod === 'api-json') {
      if (res.status === 404) return { status: 'available', httpStatus: res.status };
      if (res.status === 200) {
        try {
          const json = await res.json();
          if (json[platform.apiAvailableKey]) {
            return { status: 'taken', httpStatus: res.status, detail: json.display_name || json.handle || '' };
          }
        } catch { /* fall through */ }
        return { status: 'taken', httpStatus: res.status };
      }
      return { status: 'check-manually', httpStatus: res.status };
    }
    if (res.status === 404) return { status: 'available', httpStatus: res.status };
    if (res.status === 200) return { status: 'likely-taken', httpStatus: res.status, detail: 'verify manually — SPA may return 200 for missing pages' };
    if (res.status === 301 || res.status === 302) return { status: 'likely-taken', httpStatus: res.status };
    if (res.status === 403 || res.status === 429) return { status: 'check-manually', httpStatus: res.status, detail: 'blocked — open URL manually' };
    return { status: 'check-manually', httpStatus: res.status };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return { status: 'check-manually', detail: 'request timed out' };
    return { status: 'check-manually', detail: err.message };
  }
}

function statusBadge(status) {
  switch (status) {
    case 'available':      return '✅ Available';
    case 'likely-taken':   return '🔴 Likely taken (verify)';
    case 'taken':          return '🔴 Taken';
    case 'derived':        return 'ℹ️  See parent platform';
    case 'check-manually': return '⚠️  Check manually';
    default:               return `? ${status}`;
  }
}

function dryRunTemplate(brand_name, fallback_brands, platforms) {
  const lines = [
    `# Brand Handle Availability Sweep — ${brand_name}`,
    '',
    '> **DRY RUN** — no HTTP requests made. Preview of what will be checked.',
    `> Run with \`DRY_RUN=false\` to execute live sweep.`,
    '',
    `**Brand:** @${brand_name}  |  **Fallbacks:** ${fallback_brands.map(f => '@' + f).join(', ')}`,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Platforms to check',
    '',
    '| # | Platform | Handle | Profile URL | Method |',
    '|---|----------|--------|-------------|--------|',
  ];
  platforms.forEach((p, i) => {
    lines.push(`| ${i + 1} | ${p.name} | ${p.handle(brand_name)} | ${p.profileUrl(brand_name)} | ${p.checkMethod} |`);
  });
  lines.push('', `## Fallback handles (checked if @${brand_name} taken on ≥2 platforms)`, '');
  fallback_brands.forEach(f => lines.push(`- @${f}`));
  lines.push('', '---', '_Run with DRY_RUN=false to populate results._');
  return lines.join('\n');
}

async function liveSweep(brand_name, fallback_brands, platforms) {
  const results = {};
  console.log(`[sweep-handle] Sweeping @${brand_name} across ${platforms.length} platforms...`);
  for (const platform of platforms) {
    process.stdout.write(`  ${platform.name.padEnd(30)}`);
    const result = await checkPlatform(platform, brand_name);
    results[platform.name] = result;
    console.log(statusBadge(result.status) + (result.detail ? ` — ${result.detail}` : ''));
    await new Promise(r => setTimeout(r, 800));
  }
  const takenCount = Object.values(results).filter(r => r.status === 'taken' || r.status === 'likely-taken').length;
  const runFallbacks = takenCount >= 2;
  let fallbackResults = {};
  if (runFallbacks) {
    console.log(`\n[sweep-handle] @${brand_name} taken on ${takenCount} platforms — running fallback sweep...`);
    for (const fallback of fallback_brands) {
      fallbackResults[fallback] = {};
      for (const platform of platforms.filter(p => p.checkMethod !== 'derived')) {
        process.stdout.write(`  ${fallback}/${platform.name.padEnd(25)}`);
        const result = await checkPlatform(platform, fallback);
        fallbackResults[fallback][platform.name] = result;
        console.log(statusBadge(result.status));
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }
  return { results, takenCount, runFallbacks, fallbackResults };
}

function renderReport(brand_name, platforms, { results, takenCount, runFallbacks, fallbackResults }) {
  const lines = [
    `# Brand Handle Availability Sweep — ${brand_name}`,
    '',
    `**Brand:** @${brand_name}  |  **Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Status:** ${takenCount >= 2 ? `@${brand_name} taken on ${takenCount} platforms — fallback sweep run` : `@${brand_name} available on majority of platforms`}`,
    '',
    `## @${brand_name} — Primary Handle Results`,
    '',
    '| Platform | Handle | Status | Notes |',
    '|----------|--------|--------|-------|',
  ];
  for (const platform of platforms) {
    const r = results[platform.name];
    const badge = statusBadge(r.status);
    const detail = r.detail || (r.httpStatus ? `HTTP ${r.httpStatus}` : '');
    const notes = [platform.note, detail].filter(Boolean).join(' · ');
    lines.push(`| ${platform.name} | ${platform.handle(brand_name)} | ${badge} | ${notes} |`);
  }
  lines.push('');
  lines.push(`**Platforms taken:** ${takenCount} / ${platforms.filter(p => p.checkMethod !== 'derived').length}`);
  if (runFallbacks) {
    lines.push('', '## Fallback Handle Results', '');
    for (const [fallback, fbResults] of Object.entries(fallbackResults)) {
      lines.push(`### @${fallback}`, '', '| Platform | Status |', '|----------|--------|');
      for (const [pName, r] of Object.entries(fbResults)) {
        lines.push(`| ${pName} | ${statusBadge(r.status)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('', '## Fallback Sweep', '', `@${brand_name} not taken on ≥2 platforms — no fallback sweep needed.`);
  }
  lines.push('', '## Manual Verification Links', '', '| Platform | URL |', '|----------|-----|');
  for (const p of platforms) {
    if (p.profileUrl) lines.push(`| ${p.name} | ${p.profileUrl(brand_name)} |`);
  }
  lines.push('', '---', `_Generated by sweep-handle.mjs at ${new Date().toISOString()}_`);
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function sweep(config = {}) {
  const brand_name = config.brand_name || process.env.BRAND_NAME || 'example-brand';
  const fallback_brands = config.fallback_brands || [brand_name + 'studio', brand_name + 'media'];
  const platforms = config.platforms || DEFAULT_PLATFORMS;
  const dry_run = config.dry_run ?? (process.env.DRY_RUN !== 'false');
  const output_dir = config.output_dir || resolve(__dirname, '../../');

  mkdirSync(output_dir, { recursive: true });
  const OUTPUT = resolve(output_dir, `${brand_name}-handle-sweep.md`);

  if (dry_run) {
    console.log('[sweep-handle] DRY_RUN=true — writing template report, no HTTP requests');
    writeFileSync(OUTPUT, dryRunTemplate(brand_name, fallback_brands, platforms), 'utf8');
    console.log(`[sweep-handle] Written: ${OUTPUT}`);
    return { output: OUTPUT, dry_run: true };
  }

  console.log('[sweep-handle] DRY_RUN=false — running live sweep');
  const data = await liveSweep(brand_name, fallback_brands, platforms);
  const report = renderReport(brand_name, platforms, data);
  writeFileSync(OUTPUT, report, 'utf8');
  console.log(`\n[sweep-handle] Report written: ${OUTPUT}`);
  return { output: OUTPUT, dry_run: false, takenCount: data.takenCount, runFallbacks: data.runFallbacks };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sweep({}).catch(err => { console.error('[sweep-handle] FATAL:', err.message); process.exit(1); });
}
