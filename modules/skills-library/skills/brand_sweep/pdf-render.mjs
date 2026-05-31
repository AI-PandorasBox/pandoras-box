#!/usr/bin/env node
/**
 * pdf-render.mjs — Brand sweep orchestrator + PDF renderer
 * Part of $INSTALL_PATH/shared/skills/library/brand_sweep/
 * Guard: _BRAND_SWEEP_TOOL_V1
 *
 * Entry point for the brand_sweep skill. Runs all 4 sweep modules,
 * synthesises an action plan, then renders a combined PDF via Chrome headless
 * (same infrastructure as generate_pdf in personal-ai.mjs).
 *
 * Exports brandSweep(config) for module use.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = __dirname;

const CHROME = (process.env.PBOX_CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome-stable'));
const OUTPUT_DROPS = './output';
const OUTPUT_PDFS = './output';
const OUTPUT_COPY_DIR = './output';

// ── HTML composer ─────────────────────────────────────────────────────────────

function mdToHtmlBlocks(md) {
  if (!md) return '<p><em>Report not available.</em></p>';
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{4}\s(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.slice(1, -1).split('|').map(c => c.trim());
      const isHeader = cells.every(c => /^-+$/.test(c));
      if (isHeader) return '';
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, m => `<table>${m}</table>`)
    .replace(/^---+$/gm, '<hr>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function composePdfHtml(brand_name, date, sections) {
  const sectionHtml = sections.map(({ title, content, icon }) => `
    <section class="report-section">
      <div class="section-header">
        <span class="section-icon">${icon}</span>
        <h2>${title}</h2>
      </div>
      <div class="section-body">${mdToHtmlBlocks(content)}</div>
    </section>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 18mm 20mm 18mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: #fff; }

  /* Cover page */
  .cover { page-break-after: always; display: flex; flex-direction: column;
    justify-content: center; align-items: center; min-height: 250mm;
    background: linear-gradient(135deg, #0d1b2a 0%, #1b3a5e 60%, #2a5a8e 100%);
    color: #fff; text-align: center; padding: 40px; border-radius: 4px; }
  .cover-brand { font-size: 42pt; font-weight: 900; letter-spacing: 2px;
    text-transform: uppercase; color: #00d1ff; margin-bottom: 12px; }
  .cover-title { font-size: 18pt; font-weight: 300; color: #c8e0f0; margin-bottom: 8px; }
  .cover-meta { font-size: 10pt; color: #7faacc; margin-top: 24px; }
  .cover-badge { display: inline-block; background: #00d1ff22; border: 1px solid #00d1ff;
    border-radius: 20px; padding: 4px 16px; font-size: 9pt; color: #00d1ff; margin-top: 12px; }

  /* TOC */
  .toc { page-break-after: always; padding: 20px 0; }
  .toc h2 { font-size: 16pt; color: #1b3a5e; border-bottom: 2px solid #00d1ff;
    padding-bottom: 8px; margin-bottom: 20px; }
  .toc-item { display: flex; justify-content: space-between; padding: 8px 0;
    border-bottom: 1px solid #eee; font-size: 11pt; }
  .toc-icon { margin-right: 8px; }
  .toc-page { color: #7faacc; }

  /* Sections */
  .report-section { page-break-inside: avoid; margin-bottom: 30px; }
  .section-header { display: flex; align-items: center; gap: 10px;
    background: linear-gradient(90deg, #1b3a5e 0%, #2a5a8e 100%);
    color: #fff; padding: 12px 16px; border-radius: 4px 4px 0 0; margin-bottom: 0; }
  .section-icon { font-size: 18pt; }
  .section-header h2 { font-size: 14pt; font-weight: 600; margin: 0; }
  .section-body { border: 1px solid #d0dce8; border-top: none; padding: 16px;
    border-radius: 0 0 4px 4px; background: #f9fbfd; }

  /* Typography within sections */
  .section-body h1, .section-body h2 { color: #1b3a5e; font-size: 12pt;
    margin: 12px 0 6px 0; border-bottom: 1px solid #d0dce8; padding-bottom: 4px; }
  .section-body h3, .section-body h4 { color: #2a5a8e; font-size: 11pt; margin: 10px 0 4px 0; }
  .section-body p { margin: 6px 0; line-height: 1.5; }
  .section-body blockquote { border-left: 3px solid #00d1ff; padding-left: 10px;
    color: #555; margin: 8px 0; font-style: italic; }
  .section-body code { background: #e8f0f8; padding: 1px 4px; border-radius: 3px;
    font-family: monospace; font-size: 10pt; }
  .section-body ul { margin: 6px 0 6px 20px; }
  .section-body li { margin: 3px 0; }
  .section-body hr { border: none; border-top: 1px solid #d0dce8; margin: 12px 0; }
  .section-body em { color: #666; }
  .section-body strong { color: #1a1a1a; }

  /* Tables */
  .section-body table { width: 100%; border-collapse: collapse; margin: 10px 0;
    font-size: 10pt; }
  .section-body td { padding: 6px 8px; border: 1px solid #d0dce8; vertical-align: top; }
  .section-body tr:first-child td { background: #1b3a5e; color: #fff; font-weight: 600; }
  .section-body tr:nth-child(even) td { background: #f0f5fa; }

  /* Footer */
  .footer { position: fixed; bottom: 10mm; left: 0; right: 0; text-align: center;
    font-size: 8pt; color: #999; border-top: 1px solid #eee; padding-top: 4px; }
  .disclaimer { background: #fff8e1; border: 1px solid #f0c040; border-radius: 4px;
    padding: 12px 16px; margin: 20px 0; font-size: 10pt; color: #7a5800; }
</style>
</head>
<body>

<!-- Cover -->
<div class="cover">
  <div class="cover-brand">${brand_name}</div>
  <div class="cover-title">Brand Availability Sweep</div>
  <div class="cover-meta">Generated by Pandora's Box</div>
  <div class="cover-meta">${date}</div>
  <div class="cover-badge">CONFIDENTIAL — NOT LEGAL ADVICE</div>
</div>

<!-- TOC -->
<div class="toc">
  <h2>Contents</h2>
  <div class="toc-item"><span><span class="toc-icon">📱</span> Social Handle Availability</span><span class="toc-page">Section 1</span></div>
  <div class="toc-item"><span><span class="toc-icon">🌐</span> Domain Availability</span><span class="toc-page">Section 2</span></div>
  <div class="toc-item"><span><span class="toc-icon">™️</span> Trademark Conflict Check</span><span class="toc-page">Section 3</span></div>
  <div class="toc-item"><span><span class="toc-icon">✍️</span> Author Byline Conflict Check</span><span class="toc-page">Section 4</span></div>
  <div class="toc-item"><span><span class="toc-icon">📋</span> Reservation Action Plan</span><span class="toc-page">Section 5</span></div>
</div>

<div class="disclaimer">
  <strong>Disclaimer:</strong> This report is a preliminary automated sweep for internal research purposes only.
  It does not constitute legal advice. Trademark results in particular should be verified by a qualified
  UK trademark attorney before any filing or commercial commitment.
</div>

${sectionHtml}

<div class="footer">
  Brand Sweep — ${brand_name} — ${date} — Generated by Pandora's Box · NOT LEGAL ADVICE
</div>

</body>
</html>`;
}

// ── PDF renderer ──────────────────────────────────────────────────────────────

async function renderPdf(htmlContent, filename) {
  const id = randomUUID();
  const tmpHtml = `/tmp/brand-sweep-${id}.html`;
  const outPdf = `${OUTPUT_PDFS}/${id}.pdf`;
  const meta = { id, filename: filename + '.pdf', created: Date.now() };

  mkdirSync(OUTPUT_PDFS, { recursive: true });
  writeFileSync(tmpHtml, htmlContent, 'utf8');

  try {
    execFileSync(CHROME, [
      '--headless', '--no-sandbox',
      `--print-to-pdf=${outPdf}`,
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      tmpHtml,
    ], { timeout: 45000 });

    writeFileSync(`${OUTPUT_PDFS}/${id}.json`, JSON.stringify(meta), 'utf8');

    // Copy to the output dir for persistent access
    try {
      mkdirSync(OUTPUT_COPY_DIR, { recursive: true });
      const safeName = meta.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      writeFileSync(join(OUTPUT_COPY_DIR, safeName), readFileSync(outPdf));
    } catch { /* non-fatal */ }

    // Copy to drops/general/documents/
    const dropDir = join(OUTPUT_DROPS, 'general', 'documents');
    mkdirSync(dropDir, { recursive: true });
    writeFileSync(join(dropDir, meta.filename), readFileSync(outPdf));

    // Cleanup after 1 hour
    setTimeout(() => {
      try { require('fs').unlinkSync(outPdf); } catch {}
      try { require('fs').unlinkSync(`${OUTPUT_PDFS}/${id}.json`); } catch {}
    }, 3600000);

    return {
      ok: true,
      id,
      filename: meta.filename,
      pdf_path: join(dropDir, meta.filename),
      download_url: `/api/pdf-download/${id}`,
    };
  } finally {
    try { require('fs').unlinkSync(tmpHtml); } catch {}
  }
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function brandSweep(config = {}) {
  const brand_name = config.brand_name;
  if (!brand_name) throw new Error('brand_sweep: brand_name is required');

  const byline = config.byline || 'Your Name';
  const dry_run = config.dry_run ?? (process.env.DRY_RUN !== 'false');
  const date = new Date().toISOString().split('T')[0];

  // Output dir for markdown reports: drops/general/reports/
  const output_dir = join(OUTPUT_DROPS, 'general', 'reports');
  mkdirSync(output_dir, { recursive: true });

  // Shared sweep config
  const sweepConfig = {
    brand_name,
    byline,
    fallback_brands: config.fallback_brands || [brand_name + 'studio', brand_name + 'media'],
    platforms: config.platforms || undefined,
    tlds: config.tlds || undefined,
    trademark_classes: config.trademark_classes || undefined,
    byline_catalogs: config.byline_catalogs || undefined,
    output_dir,
    dry_run,
  };

  console.log(`[brand-sweep] Starting sweep for: ${brand_name} (dry_run=${dry_run})`);

  // ── Run all 4 sweeps ──────────────────────────────────────────────────────
  const { sweep: sweepHandle } = await import(join(SKILL_DIR, 'sweep-handle.mjs'));
  const { sweep: sweepDomain } = await import(join(SKILL_DIR, 'sweep-domain.mjs'));
  const { sweep: sweepTrademark } = await import(join(SKILL_DIR, 'sweep-trademark.mjs'));
  const { sweep: sweepByline } = await import(join(SKILL_DIR, 'sweep-byline.mjs'));
  const { run: runActionPlan } = await import(join(SKILL_DIR, 'action-plan.mjs'));

  const [handleResult, domainResult, trademarkResult, bylineResult] = await Promise.allSettled([
    sweepHandle(sweepConfig),
    sweepDomain(sweepConfig),
    sweepTrademark(sweepConfig),
    sweepByline(sweepConfig),
  ]);

  // ── Run action plan (reads sweep outputs) ─────────────────────────────────
  await runActionPlan(sweepConfig);

  // ── Compose report paths ──────────────────────────────────────────────────
  const reports = {
    handle:      join(output_dir, `${brand_name}-handle-sweep.md`),
    domain:      join(output_dir, `${brand_name}-domain-sweep.md`),
    trademark:   join(output_dir, `${brand_name}-trademark.md`),
    byline:      join(output_dir, `${brand_name}-byline.md`),
    action_plan: join(output_dir, `${brand_name}-action-plan.md`),
  };

  // ── Render PDF ────────────────────────────────────────────────────────────
  const readReport = (path) => existsSync(path) ? readFileSync(path, 'utf8') : null;

  const sections = [
    { title: 'Social Handle Availability', icon: '📱', content: readReport(reports.handle) },
    { title: 'Domain Availability',        icon: '🌐', content: readReport(reports.domain) },
    { title: 'Trademark Conflict Check',   icon: '™️',  content: readReport(reports.trademark) },
    { title: 'Author Byline Check',        icon: '✍️', content: readReport(reports.byline) },
    { title: 'Reservation Action Plan',    icon: '📋', content: readReport(reports.action_plan) },
  ];

  const htmlContent = composePdfHtml(brand_name, date, sections);
  const pdfFilename = `brand-sweep-${brand_name}-${date}`;

  let pdfResult;
  if (dry_run) {
    console.log(`[brand-sweep] DRY RUN — skipping PDF render`);
    pdfResult = { ok: true, dry_run: true, filename: pdfFilename + '.pdf', pdf_path: null, download_url: null };
  } else {
    console.log(`[brand-sweep] Rendering PDF: ${pdfFilename}.pdf`);
    pdfResult = await renderPdf(htmlContent, pdfFilename);
  }

  return {
    ok: true,
    brand_name,
    reports,
    pdf_path: pdfResult.pdf_path,
    pdf_url: pdfResult.download_url,
    dry_run,
  };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const brand_name = process.env.BRAND_NAME || 'example-brand';
  brandSweep({ brand_name }).then(result => {
    console.log('\n[brand-sweep] Complete:', JSON.stringify(result, null, 2));
  }).catch(err => {
    console.error('[brand-sweep] FATAL:', err.message);
    process.exit(1);
  });
}
