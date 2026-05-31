#!/usr/bin/env node
/**
 * sweep-trademark.mjs — Trademark conflict check (NOT a filing — search only)
 * Part of $INSTALL_PATH/shared/skills/library/brand_sweep/
 *
 * Queries UK IPO, USPTO, EUIPO for the brand term in specified Nice classes.
 * Retries on 5xx with exponential backoff (task007 hardening baked in).
 * HEAD-check verifies each registry endpoint before full query.
 *
 * Conflict grades:
 *   clean         — no matching marks found in class
 *   soft-conflict  — similar mark, different class (monitor)
 *   hard-conflict  — same or near-identical mark, same class (seek legal advice)
 *
 * Exports sweep(config) for module use.
 * CLI: DRY_RUN=false BRAND_NAME=Example BRAND_TERM=Example node sweep-trademark.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CLASSES = [
  { num: 9,  desc: 'Downloadable publications, e-books, digital content' },
  { num: 16, desc: 'Printed publications, books, printed matter' },
  { num: 41, desc: 'Entertainment, education, publishing services' },
];

// ── Registry query URL builders ──────────────────────────────────────────────

function ukipoUrl(term, classNum) {
  const params = new URLSearchParams({
    TMText: term, ClassNumber: String(classNum), StatusCode: 'Live',
    SearchType: 'Contains', MaxResults: '20',
  });
  return `https://trademarks.ipo.gov.uk/ipo-tmtext/faces/js/TMTextSearch-json-results.xhtml?${params}`;
}

function ukipoHeadUrl() {
  return 'https://trademarks.ipo.gov.uk/ipo-tmtext/faces/SearchForm.xhtml';
}

function usptoSearchUrl(term) {
  return `https://tmsearch.uspto.gov/api/search/results?query=${encodeURIComponent(term)}&rows=20&start=0&type=all`;
}

function usptoHeadUrl() {
  return 'https://tmsearch.uspto.gov/api/search/results?query=test&rows=1&start=0&type=all';
}

function euipoUrl(term, classNum) {
  const params = new URLSearchParams({
    criteria: term, niceclasses: String(classNum),
    status: 'REGISTERED,APPLICATION', pageSize: '20', pageNumber: '1',
    office: 'EM,GB,US',
  });
  return `https://www.tmdn.org/tmview/api/trademark/search?${params}`;
}

function euipoHeadUrl() {
  return 'https://www.tmdn.org/tmview/api/trademark/search?criteria=test&niceclasses=9&status=REGISTERED&pageSize=1&pageNumber=1&office=EM';
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function headCheck(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tm-sweep/1.0; +research)' },
    });
    clearTimeout(timeout);
    return { ok: res.status < 500, status: res.status };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

async function fetchJsonWithRetry(url, label, maxRetries = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json, text/json, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; tm-sweep/1.0; +research)',
        },
      });
      clearTimeout(timeout);
      if (res.status >= 500) {
        lastErr = `HTTP ${res.status} (attempt ${attempt}/${maxRetries})`;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`  [${label}] ${lastErr} — retry in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return { ok: false, error: lastErr };
      }
      if (res.status === 200) {
        const text = await res.text();
        try { return { ok: true, data: JSON.parse(text) }; }
        catch { return { ok: false, error: `JSON parse failed (HTTP 200)`, raw: text.slice(0, 200) }; }
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err.name === 'AbortError' ? 'timeout' : err.message;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`  [${label}] ${lastErr} — retry in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return { ok: false, error: lastErr };
    }
  }
  return { ok: false, error: lastErr };
}

// ── Result parsers ────────────────────────────────────────────────────────────

function parseUKIPO(data, term) {
  if (!data || typeof data !== 'object') return { raw: data };
  const marks = data.trademarks || data.TMTextSearchResults?.trademarks || [];
  return marks.map(m => ({
    mark: m.markText || m.wordElement || '',
    owner: m.holder || m.applicant || '',
    status: m.statusCode || m.status || '',
    classes: m.niceClasses || m.classes || [],
    appNum: m.applicationNumber || m.appNum || '',
  }));
}

function parseUSPTO(data, term) {
  if (!data || typeof data !== 'object') return { raw: data };
  const docs = data.hits?.hits || data.searchResults || [];
  return docs.map(d => {
    const src = d._source || d;
    return {
      mark: src.mark_identification || src.markText || '',
      owner: src.applicant_name || src.owner || '',
      status: src.registration_status_code || src.status || '',
      classes: src.international_codes_text?.split(',').map(s => s.trim()) || [],
      regNum: src.registration_number || src.regNum || '',
    };
  });
}

function parseEUIPO(data, term) {
  if (!data || typeof data !== 'object') return { raw: data };
  const marks = data.trademarks || data.results || [];
  return marks.map(m => ({
    mark: m.markText || m.wordElement || m.brandName || '',
    owner: m.applicant || m.holder || '',
    status: m.status || '',
    classes: m.niceClasses || [],
    regNum: m.applicationNumber || m.refNum || '',
  }));
}

// ── Conflict grader ───────────────────────────────────────────────────────────

function gradeConflict(marks, targetTerm, targetClass) {
  if (!Array.isArray(marks) || marks.length === 0) return 'clean';
  const termNorm = targetTerm.toLowerCase().replace(/[^a-z]/g, '');

  const exactInClass = marks.filter(m => {
    const markNorm = (m.mark || '').toLowerCase().replace(/[^a-z]/g, '');
    const classMatch = (m.classes || []).some(c => String(c).replace(/\D/g, '') === String(targetClass));
    return (markNorm === termNorm || markNorm.includes(termNorm) || termNorm.includes(markNorm)) && classMatch;
  });
  if (exactInClass.length > 0) return 'hard-conflict';

  const exactOtherClass = marks.filter(m => {
    const markNorm = (m.mark || '').toLowerCase().replace(/[^a-z]/g, '');
    return markNorm === termNorm;
  });
  if (exactOtherClass.length > 0) return 'soft-conflict';

  return 'clean';
}

function conflictBadge(grade) {
  switch (grade) {
    case 'clean':         return '✅ Clean';
    case 'soft-conflict': return '⚠️  Soft conflict';
    case 'hard-conflict': return '🔴 Hard conflict';
    default:              return `? ${grade}`;
  }
}

// ── Main sweep ────────────────────────────────────────────────────────────────

async function querySweep(term, classes) {
  const rows = [];

  // HEAD-check each registry before running full queries
  const registries = [
    { label: 'UK IPO', headUrl: ukipoHeadUrl() },
    { label: 'USPTO',  headUrl: usptoHeadUrl() },
    { label: 'EUIPO',  headUrl: euipoHeadUrl() },
  ];
  const reachable = {};
  console.log(`\n[sweep-trademark] Pre-flight HEAD checks...`);
  for (const r of registries) {
    process.stdout.write(`  ${r.label.padEnd(12)}`);
    const hc = await headCheck(r.headUrl, r.label);
    reachable[r.label] = hc.ok;
    console.log(hc.ok ? `✅ reachable (HTTP ${hc.status})` : `⚠️  ${hc.error || 'HTTP ' + hc.status} — will attempt anyway`);
  }

  for (const cls of classes) {
    console.log(`\n[sweep-trademark] Class ${cls.num} — ${cls.desc}`);

    // UK IPO
    process.stdout.write(`  UK IPO...  `);
    const ukRes = await fetchJsonWithRetry(ukipoUrl(term, cls.num), 'UKIPO');
    let ukMarks = [], ukGrade, ukNote;
    if (ukRes.ok) {
      ukMarks = parseUKIPO(ukRes.data, term);
      ukGrade = Array.isArray(ukMarks) ? gradeConflict(ukMarks, term, cls.num) : 'check-manually';
      ukNote = Array.isArray(ukMarks) ? `${ukMarks.length} result(s)` : 'parse error';
    } else {
      ukGrade = 'check-manually';
      ukNote = ukRes.error;
    }
    console.log(`${conflictBadge(ukGrade)} — ${ukNote}`);
    rows.push({ registry: 'UK IPO', class: cls.num, grade: ukGrade, count: Array.isArray(ukMarks) ? ukMarks.length : null, marks: Array.isArray(ukMarks) ? ukMarks : [], note: ukNote, searchUrl: `https://trademarks.ipo.gov.uk/ipo-tmtext/faces/SearchForm.xhtml` });
    await new Promise(r => setTimeout(r, 800));

    // USPTO
    process.stdout.write(`  USPTO...   `);
    const usRes = await fetchJsonWithRetry(usptoSearchUrl(term), 'USPTO');
    let usMarks = [], usGrade, usNote;
    if (usRes.ok) {
      usMarks = parseUSPTO(usRes.data, term);
      usGrade = Array.isArray(usMarks) ? gradeConflict(usMarks, term, cls.num) : 'check-manually';
      usNote = Array.isArray(usMarks) ? `${usMarks.length} result(s)` : 'parse error';
    } else {
      usGrade = 'check-manually';
      usNote = usRes.error;
    }
    console.log(`${conflictBadge(usGrade)} — ${usNote}`);
    rows.push({ registry: 'USPTO', class: cls.num, grade: usGrade, count: Array.isArray(usMarks) ? usMarks.length : null, marks: Array.isArray(usMarks) ? usMarks : [], note: usNote, searchUrl: `https://tmsearch.uspto.gov/search/search-information` });
    await new Promise(r => setTimeout(r, 800));

    // EUIPO
    process.stdout.write(`  EUIPO...   `);
    const euRes = await fetchJsonWithRetry(euipoUrl(term, cls.num), 'EUIPO');
    let euMarks = [], euGrade, euNote;
    if (euRes.ok) {
      euMarks = parseEUIPO(euRes.data, term);
      euGrade = Array.isArray(euMarks) ? gradeConflict(euMarks, term, cls.num) : 'check-manually';
      euNote = Array.isArray(euMarks) ? `${euMarks.length} result(s)` : 'parse error';
    } else {
      euGrade = 'check-manually';
      euNote = euRes.error;
    }
    console.log(`${conflictBadge(euGrade)} — ${euNote}`);
    rows.push({ registry: 'EUIPO', class: cls.num, grade: euGrade, count: Array.isArray(euMarks) ? euMarks.length : null, marks: Array.isArray(euMarks) ? euMarks : [], note: euNote, searchUrl: `https://www.tmdn.org/tmview/welcome#!Results` });
    await new Promise(r => setTimeout(r, 800));
  }
  return rows;
}

function overallVerdict(rows) {
  if (rows.some(r => r.grade === 'hard-conflict')) return 'hard-conflict';
  if (rows.some(r => r.grade === 'soft-conflict')) return 'soft-conflict';
  if (rows.some(r => r.grade === 'check-manually')) return 'check-manually';
  return 'clean';
}

function dryRunTemplate(term, classes) {
  const lines = [
    `# Trademark Conflict Report — "${term}"`,
    '',
    '> **DRY RUN** — no registry queries made. Preview of what will be checked.',
    `> Run with \`DRY_RUN=false\` to execute live sweep.`,
    '',
    `**Search term:** "${term}"  |  **Date:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Registries and classes to check',
    '',
    '| Registry | Class | Description | Search URL |',
    '|----------|-------|-------------|-----------|',
  ];
  for (const cls of classes) {
    lines.push(`| UK IPO | ${cls.num} | ${cls.desc} | https://trademarks.ipo.gov.uk/ipo-tmtext/faces/SearchForm.xhtml |`);
    lines.push(`| USPTO | ${cls.num} | ${cls.desc} | https://tmsearch.uspto.gov/search/search-information |`);
    lines.push(`| EUIPO | ${cls.num} | ${cls.desc} | https://www.tmdn.org/tmview/welcome |`);
  }
  lines.push(
    '', '## Conflict grading', '',
    '- **Clean** — no matching or similar marks found in that class',
    '- **Soft conflict** — similar mark exists but in a different class (monitor)',
    '- **Hard conflict** — same or near-identical mark in the same class (seek legal advice)',
    '', '---', '_Run with DRY_RUN=false to populate results._',
  );
  return lines.join('\n');
}

function renderReport(term, rows) {
  const verdict = overallVerdict(rows);
  const lines = [
    `# Trademark Conflict Report — "${term}"`,
    '',
    `**Search term:** "${term}"  |  **Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Overall verdict:** ${conflictBadge(verdict)}`,
    '',
    '> This is a preliminary desktop search, NOT legal advice. A hard or soft conflict',
    '> should prompt consultation with a UK trademark attorney before filing.',
    '',
    '## Results by class',
    '',
    '| Registry | Class | Conflict grade | Results | Notes |',
    '|----------|-------|---------------|---------|-------|',
  ];
  for (const r of rows) {
    lines.push(`| ${r.registry} | ${r.class} | ${conflictBadge(r.grade)} | ${r.count ?? '?'} | ${r.note} |`);
  }
  const conflicts = rows.filter(r => r.grade === 'hard-conflict' || r.grade === 'soft-conflict');
  if (conflicts.length > 0) {
    lines.push('', '## Conflict detail', '');
    for (const row of conflicts) {
      if (!row.marks || row.marks.length === 0) continue;
      lines.push(`### ${row.registry} — Class ${row.class}`, '', '| Mark | Owner | Status | Classes |', '|------|-------|--------|---------|');
      for (const m of row.marks.slice(0, 10)) {
        const cls = Array.isArray(m.classes) ? m.classes.join(', ') : '';
        lines.push(`| ${m.mark || ''} | ${m.owner || ''} | ${m.status || ''} | ${cls} |`);
      }
      lines.push('');
    }
  }
  lines.push(
    '', '## Manual verification links', '',
    `- UK IPO: https://trademarks.ipo.gov.uk/ipo-tmtext/faces/SearchForm.xhtml (search: ${term})`,
    `- USPTO TESS: https://tmsearch.uspto.gov/search/search-information`,
    `- EUIPO TMview: https://www.tmdn.org/tmview/welcome`,
    '', '## Next step', '',
  );
  if (verdict === 'clean') {
    lines.push(`All three registries returned clean for specified classes. Safe to proceed with UK trademark filing (~£200/class).`);
  } else if (verdict === 'soft-conflict') {
    lines.push('Soft conflict(s) detected. Review with a trademark attorney before filing. Proceed with caution.');
  } else if (verdict === 'hard-conflict') {
    lines.push('Hard conflict(s) detected. Consult a UK trademark attorney before filing. Consider alternative brand names.');
  } else {
    lines.push('Some registries could not be queried automatically. Complete manual verification before proceeding.');
  }
  lines.push('', '---', `_Generated by sweep-trademark.mjs at ${new Date().toISOString()}_`);
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function sweep(config = {}) {
  // term is the capitalised search string (e.g. "Example Brand", "Example Brand")
  const brand_name = config.brand_name || process.env.BRAND_NAME || 'example-brand';
  const term = config.trademark_term || (brand_name.charAt(0).toUpperCase() + brand_name.slice(1));
  const classes = config.trademark_classes?.map(n => DEFAULT_CLASSES.find(c => c.num === n) || { num: n, desc: `Class ${n}` }) || DEFAULT_CLASSES;
  const dry_run = config.dry_run ?? (process.env.DRY_RUN !== 'false');
  const output_dir = config.output_dir || resolve(__dirname, '../../');

  mkdirSync(output_dir, { recursive: true });
  const OUTPUT = resolve(output_dir, `${brand_name}-trademark.md`);

  if (dry_run) {
    console.log('[sweep-trademark] DRY_RUN=true — writing template report, no registry queries');
    writeFileSync(OUTPUT, dryRunTemplate(term, classes), 'utf8');
    console.log(`[sweep-trademark] Written: ${OUTPUT}`);
    return { output: OUTPUT, dry_run: true };
  }

  console.log(`[sweep-trademark] DRY_RUN=false — querying UK IPO, USPTO, EUIPO for "${term}"`);
  const rows = await querySweep(term, classes);
  writeFileSync(OUTPUT, renderReport(term, rows), 'utf8');
  console.log(`\n[sweep-trademark] Report written: ${OUTPUT}`);
  return { output: OUTPUT, dry_run: false, verdict: overallVerdict(rows) };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sweep({}).catch(err => { console.error('[sweep-trademark] FATAL:', err.message); process.exit(1); });
}
