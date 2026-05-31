#!/usr/bin/env node
/**
 * sweep-byline.mjs — Author byline conflict check
 * Part of $INSTALL_PATH/shared/skills/library/brand_sweep/
 *
 * Searches KDP, Goodreads, LoC, Open Library, WorldCat for the author name.
 * Goal: assess confusion risk with other published authors sharing the name.
 *
 * Exports sweep(config) for module use.
 * CLI: DRY_RUN=false BRAND_NAME=example-brand BYLINE="Your Name" node sweep-byline.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildDefaultSources(author) {
  const enc = encodeURIComponent(author);
  return [
    {
      name: 'Amazon UK (KDP author pages)',
      searchUrl: `https://www.amazon.co.uk/s?k=${enc}&i=stripbooks&field-author=${enc}`,
      method: 'html-scrape',
      note: 'Amazon may block automated requests — result may require manual verification',
    },
    {
      name: 'Goodreads',
      searchUrl: `https://www.goodreads.com/search?q=${enc}&search_type=books&search[field]=author`,
      method: 'html-scrape',
      note: 'Goodreads search is public. Look for author pages with this name.',
    },
    {
      name: 'Library of Congress',
      searchUrl: `https://catalog.loc.gov/vwebv/search?searchCode=NAME&searchArg=${enc}&searchType=1&limitTo=none&recCount=25`,
      method: 'html-scrape',
      note: 'LoC catalog is authoritative for published works.',
    },
    {
      name: 'Open Library (Internet Archive)',
      searchUrl: `https://openlibrary.org/search/authors?q=${enc}`,
      apiUrl: `https://openlibrary.org/search/authors.json?q=${enc}`,
      method: 'api-json',
      note: 'Open Library indexes most commercially published books. JSON API available.',
    },
    {
      name: 'WorldCat (OCLC)',
      searchUrl: `https://www.worldcat.org/search?q=au%3A${enc}`,
      method: 'html-scrape',
      note: 'WorldCat covers global library holdings.',
    },
  ];
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
    clearTimeout(timeout);
    const text = await res.text();
    return { ok: res.status < 400, status: res.status, body: text };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 0, body: '', error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'byline-sweep/1.0' },
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.message };
  }
}

function countOccurrences(haystack, needle) {
  return (haystack.match(new RegExp(needle, 'gi')) || []).length;
}

function extractTextSnippets(html, term, maxSnippets = 3) {
  const termLower = term.toLowerCase();
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const idx = [];
  let pos = 0;
  while ((pos = text.toLowerCase().indexOf(termLower, pos)) !== -1) {
    idx.push(pos); pos += term.length;
    if (idx.length >= maxSnippets) break;
  }
  return idx.map(i => {
    const start = Math.max(0, i - 60);
    const end = Math.min(text.length, i + 80);
    return '...' + text.slice(start, end).trim() + '...';
  });
}

async function checkSource(source, author) {
  const url = source.apiUrl || source.searchUrl;
  const authorLower = author.toLowerCase();
  process.stdout.write(`  ${source.name.padEnd(35)}`);

  if (source.method === 'api-json') {
    const res = await fetchJson(url);
    if (!res.ok) {
      console.log(`⚠️  check manually — ${res.error || 'HTTP ' + res.status}`);
      return { status: 'check-manually', count: null, error: res.error, snippets: [] };
    }
    const docs = res.data?.docs || [];
    const matches = docs.filter(d => {
      const name = (d.name || '').toLowerCase();
      const parts = authorLower.split(' ');
      return name.includes(authorLower) || (parts.length >= 2 && name.includes(`${parts[1]}, ${parts[0]}`));
    });
    if (matches.length === 0) { console.log('✅ No matches found'); return { status: 'clean', count: 0, entries: [], snippets: [] }; }
    console.log(`⚠️  ${matches.length} author(s) found`);
    return {
      status: 'conflict', count: matches.length,
      entries: matches.slice(0, 5).map(d => ({ name: d.name || '', workCount: d.work_count || 0, url: d.key ? `https://openlibrary.org${d.key}` : null })),
      snippets: [],
    };
  }

  const res = await fetchPage(url);
  if (!res.ok || !res.body) {
    console.log(`⚠️  check manually — ${res.error || 'HTTP ' + res.status}`);
    return { status: 'check-manually', count: null, error: res.error || `HTTP ${res.status}`, snippets: [] };
  }
  const occurrences = countOccurrences(res.body, authorLower);
  const snippets = extractTextSnippets(res.body, authorLower, 3);
  if (occurrences === 0) { console.log('✅ No matches found'); return { status: 'clean', count: 0, snippets: [] }; }
  console.log(`⚠️  "${author}" found ~${occurrences} time(s) on page`);
  return { status: 'conflict', count: occurrences, snippets };
}

function riskBadge(status) {
  switch (status) {
    case 'clean':          return '✅ No conflicts found';
    case 'conflict':       return '⚠️  Author name(s) found — review required';
    case 'check-manually': return '⚠️  Check manually';
    default:               return `? ${status}`;
  }
}

function dryRunTemplate(author, sources) {
  const lines = [
    `# Author Byline Conflict Check — "${author}"`,
    '',
    '> **DRY RUN** — no HTTP requests made. Preview of what will be checked.',
    `> Run with \`DRY_RUN=false\` to execute live sweep.`,
    '',
    `**Author name:** "${author}"`,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Sources to check',
    '',
    '| Source | Method | URL |',
    '|--------|--------|-----|',
  ];
  for (const s of sources) lines.push(`| ${s.name} | ${s.method} | ${s.searchUrl} |`);
  lines.push('', '---', '_Run with DRY_RUN=false to populate results._');
  return lines.join('\n');
}

function renderReport(author, sources, results) {
  const anyConflict = results.some(r => r.result.status === 'conflict');
  const anyManual = results.some(r => r.result.status === 'check-manually');
  const verdict = anyConflict ? 'conflict' : anyManual ? 'check-manually' : 'clean';
  const lines = [
    `# Author Byline Conflict Check — "${author}"`,
    '',
    `**Author name:** "${author}"  |  **Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Overall verdict:** ${riskBadge(verdict)}`,
    '',
    '> **Scope:** Checks for existing published authors using this name in major publishing catalogs.',
    '> This is a name availability check, not a legal trademark search.',
    '',
    '## Results by source',
    '',
    '| Source | Status | Hits | Notes |',
    '|--------|--------|------|-------|',
  ];
  for (const r of results) {
    const badge = riskBadge(r.result.status);
    const hits = r.result.count !== null ? String(r.result.count) : '?';
    lines.push(`| ${r.source.name} | ${badge} | ${hits} | ${r.source.note} |`);
  }
  const conflictResults = results.filter(r => r.result.status === 'conflict' && r.result.snippets?.length > 0);
  if (conflictResults.length > 0) {
    lines.push('', '## Context snippets', '');
    for (const r of conflictResults) {
      lines.push(`### ${r.source.name}`, '');
      for (const snip of r.result.snippets) lines.push(`> ${snip.replace(/`/g, "'")}`);
      lines.push('');
    }
  }
  const olResult = results.find(r => r.source.name.includes('Open Library'));
  if (olResult?.result?.entries?.length > 0) {
    lines.push('', '## Open Library author entries', '', '| Name | Works | Link |', '|------|-------|------|');
    for (const e of olResult.result.entries) lines.push(`| ${e.name} | ${e.workCount} | ${e.url || ''} |`);
    lines.push('');
  }
  lines.push('', '## Risk assessment', '');
  if (verdict === 'clean') {
    lines.push(`No other published authors named "${author}" found in major catalogs. Byline appears clear for use.`);
  } else if (verdict === 'conflict') {
    lines.push(`One or more existing authors using "${author}" were found. Review entries above and consider a middle initial or variant.`);
  } else {
    lines.push('Some sources could not be checked automatically. Manual verification recommended using links below.');
  }
  lines.push('', '## Manual verification links', '');
  for (const s of sources) lines.push(`- [${s.name}](${s.searchUrl})`);
  lines.push('', '---', `_Generated by sweep-byline.mjs at ${new Date().toISOString()}_`);
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function sweep(config = {}) {
  const author = config.byline || process.env.BYLINE || 'Your Name';
  const brand_name = config.brand_name || process.env.BRAND_NAME || 'example-brand';
  const sources = config.byline_catalogs || buildDefaultSources(author);
  const dry_run = config.dry_run ?? (process.env.DRY_RUN !== 'false');
  const output_dir = config.output_dir || resolve(__dirname, '../../');

  mkdirSync(output_dir, { recursive: true });
  const OUTPUT = resolve(output_dir, `${brand_name}-byline.md`);

  if (dry_run) {
    console.log('[sweep-byline] DRY_RUN=true — writing template report, no HTTP requests');
    writeFileSync(OUTPUT, dryRunTemplate(author, sources), 'utf8');
    console.log(`[sweep-byline] Written: ${OUTPUT}`);
    return { output: OUTPUT, dry_run: true };
  }

  console.log(`[sweep-byline] DRY_RUN=false — searching for "${author}" across ${sources.length} sources`);
  const results = [];
  for (const source of sources) {
    const result = await checkSource(source, author);
    results.push({ source, result });
    await new Promise(r => setTimeout(r, 1200));
  }
  writeFileSync(OUTPUT, renderReport(author, sources, results), 'utf8');
  console.log(`\n[sweep-byline] Report written: ${OUTPUT}`);
  return { output: OUTPUT, dry_run: false };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sweep({}).catch(err => { console.error('[sweep-byline] FATAL:', err.message); process.exit(1); });
}
