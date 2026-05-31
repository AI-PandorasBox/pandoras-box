#!/usr/bin/env node
// generate-manuals-pdf.mjs -- Convert Pandoras Box manuals to PDFs via headless Chrome
// Usage: node generate-manuals-pdf.mjs
// Output: staged/pdfs/*.pdf + staged/pdfs/pandoras-box-all-manuals.zip

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANUALS_DIR = resolve(__dirname, 'manuals');
const OUTPUT_DIR  = resolve(__dirname, 'pdfs');
const TEMP_DIR    = resolve(__dirname, '_pdf_tmp');

mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(TEMP_DIR,   { recursive: true });

// ---------------------------------------------------------------------------
// Find Chrome / Chromium
// ---------------------------------------------------------------------------
function findChrome() {
  const candidates = [
    ...(process.env.PBOX_CHROME_BIN ? [process.env.PBOX_CHROME_BIN] : []),
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Try PATH
  const r = spawnSync('which', ['chromium-browser'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('ERROR: Could not find Chrome or Chromium.');
  console.error('Install Google Chrome from https://www.google.com/chrome/');
  process.exit(1);
}
console.log(`Using Chrome: ${CHROME}`);

// ---------------------------------------------------------------------------
// Simple Markdown -> HTML converter (no dependencies)
// ---------------------------------------------------------------------------
function mdToHtml(md) {
  let html = md
    // Fenced code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) =>
      `<pre><code>${escHtml(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    // Headings
    .replace(/^###### (.+)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Tables
    .replace(/(\|.+\|\n)(\|[-| :]+\|\n)((\|.+\|\n)+)/g, (_, head, _sep, body) => {
      const headCols = head.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('');
      const bodyRows = body.trim().split('\n').map(row => {
        const cols = row.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cols}</tr>`;
      }).join('\n');
      return `<table><thead><tr>${headCols}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    })
    // Blockquotes (convert "**X:**" label lines in blockquote-style)
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline separation)
    .replace(/\n\n/g, '\n</p>\n<p>\n')
    // Checkboxes
    .replace(/\[ \]/g, '<input type="checkbox" disabled>')
    .replace(/\[x\]/gi, '<input type="checkbox" disabled checked>');

  // Wrap loose <li> groups in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  return `<p>${html}</p>`;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------
function wrapHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  /* Pandoras Box brand palette -- see docs/brand.css for tokens */
  :root {
    --pb-bg:        #04100e;
    --pb-surface:   #0b2320;
    --pb-border:    #1d4540;
    --pb-teal:      #00a09a;
    --pb-copper:    #c87941;
    --pb-text:      #d8ede8;
    --pb-text-dim:  #5a9a90;
    --pb-warning:   #f59e0b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #1a2e2a;
    background: #fff;
    padding: 0;
  }
  .cover {
    background: linear-gradient(135deg, var(--pb-bg) 0%, #082018 50%, #0b2320 100%);
    color: var(--pb-text);
    padding: 80px 60px;
    min-height: 200px;
    border-bottom: 3px solid var(--pb-teal);
  }
  .cover h1 {
    font-size: 28pt;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 12px;
    border: none;
    color: #fff;
  }
  .cover .subtitle {
    font-size: 13pt;
    color: var(--pb-teal);
    margin-bottom: 8px;
  }
  .cover .version {
    font-size: 10pt;
    color: var(--pb-text-dim);
  }
  .content {
    padding: 40px 60px;
    max-width: 900px;
    margin: 0 auto;
  }
  h1 { font-size: 22pt; margin: 32px 0 12px; border-bottom: 2px solid var(--pb-teal); padding-bottom: 6px; color: #0a2e2a; }
  h2 { font-size: 16pt; margin: 28px 0 10px; color: #0d3830; border-bottom: 1px solid #c8ddd9; padding-bottom: 4px; }
  h3 { font-size: 13pt; margin: 20px 0 8px; color: #1a2e2a; }
  h4 { font-size: 12pt; margin: 16px 0 6px; color: #2a4040; }
  h5, h6 { font-size: 11pt; margin: 12px 0 4px; color: #446060; }
  p { margin: 8px 0 12px; }
  ul, ol { margin: 8px 0 12px 24px; }
  li { margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 10.5pt; }
  th { background: var(--pb-bg); color: var(--pb-teal); padding: 8px 10px; text-align: left; border-bottom: 2px solid var(--pb-teal); }
  td { padding: 7px 10px; border-bottom: 1px solid #dde8e6; vertical-align: top; }
  tr:nth-child(even) td { background: #f4f9f8; }
  pre { background: var(--pb-bg); color: var(--pb-text); padding: 14px 16px; border-radius: 6px;
        font-family: 'Courier New', monospace; font-size: 9.5pt;
        overflow-x: auto; margin: 12px 0; white-space: pre-wrap;
        border-left: 3px solid var(--pb-teal); }
  code { font-family: 'Courier New', monospace; font-size: 9.5pt;
         background: #e8f4f2; color: #0d3830; padding: 1px 4px; border-radius: 3px; }
  pre code { background: none; color: inherit; padding: 0; }
  hr { border: none; border-top: 1px solid #c8ddd9; margin: 24px 0; }
  strong { font-weight: 600; }
  .disclaimer {
    background: #fffbf0;
    border-left: 4px solid var(--pb-copper);
    padding: 12px 16px;
    margin: 16px 0;
    font-size: 10.5pt;
  }
  @media print {
    body { font-size: 11pt; }
    .content { padding: 20px 30px; }
    pre { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
  }
</style>
</head>
<body>
<div class="cover">
  <h1>${title}</h1>
  <div class="subtitle">Pandoras Box -- User Documentation</div>
  <div class="version">Version 1.0 &nbsp;&nbsp;|&nbsp;&nbsp; pandoras-box.ai</div>
</div>
<div class="content">
${body}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// PDF generation via headless Chrome
// ---------------------------------------------------------------------------
function generatePdf(htmlPath, pdfPath) {
  const args = [
    '--headless',
    '--no-pdf-header-footer',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--print-to-pdf=' + pdfPath,
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=5000',
    'file://' + htmlPath,
  ];
  const result = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) {
    throw new Error(`Chrome exited with code ${result.status}: ${result.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Manual definitions
// ---------------------------------------------------------------------------
const MANUALS = [
  { md: '01-getting-started.md',   pdf: 'pandoras-box-getting-started.pdf',   title: 'Getting Started' },
  { md: '02-installation.md',      pdf: 'pandoras-box-installation.pdf',       title: 'Installation Guide' },
  { md: '03-admin-guide.md',       pdf: 'pandoras-box-admin-guide.pdf',        title: 'System Administrator Guide' },
  { md: '04-security.md',          pdf: 'pandoras-box-security.pdf',           title: 'Security Guide' },
  { md: '05-personal-assistant-user-manual.md',  pdf: 'pandoras-box-personal-assistant.pdf',          title: 'Personal Assistant User Manual' },
  { md: '06-company-agents.md',    pdf: 'pandoras-box-company-agents.pdf',     title: 'Company Agents Guide' },
  { md: '07-module-reference.md',  pdf: 'pandoras-box-module-reference.pdf',   title: 'Module Reference' },
  { md: '08-troubleshooting.md',   pdf: 'pandoras-box-troubleshooting.pdf',    title: 'Troubleshooting Guide' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const generated = [];

for (const manual of MANUALS) {
  const mdPath  = resolve(MANUALS_DIR, manual.md);
  const tmpHtml = resolve(TEMP_DIR, manual.md.replace('.md', '.html'));
  const pdfPath = resolve(OUTPUT_DIR, manual.pdf);

  if (!existsSync(mdPath)) {
    console.warn(`SKIP: ${manual.md} not found`);
    continue;
  }

  console.log(`Processing: ${manual.md} -> ${manual.pdf}`);

  const mdSource = readFileSync(mdPath, 'utf8');
  const bodyHtml = mdToHtml(mdSource);
  const fullHtml = wrapHtml(manual.title, bodyHtml);

  writeFileSync(tmpHtml, fullHtml, 'utf8');

  try {
    generatePdf(tmpHtml, pdfPath);
    const stat = spawnSync('du', ['-sh', pdfPath], { encoding: 'utf8' });
    const size = stat.stdout.split('\t')[0].trim();
    console.log(`  OK: ${manual.pdf} (${size})`);
    generated.push(pdfPath);
  } catch (err) {
    console.error(`  FAIL: ${manual.pdf} -- ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Create ZIP bundle
// ---------------------------------------------------------------------------
if (generated.length > 0) {
  const zipPath = resolve(OUTPUT_DIR, 'pandoras-box-all-manuals.zip');
  console.log('\nCreating ZIP bundle...');
  try {
    const pdfFiles = generated.map(p => basename(p)).join(' ');
    spawnSync('bash', ['-c', `cd "${OUTPUT_DIR}" && zip -j "${zipPath}" ${pdfFiles}`],
      { encoding: 'utf8' });
    console.log(`  OK: pandoras-box-all-manuals.zip`);
  } catch (err) {
    console.warn(`  Could not create ZIP: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nDone. ${generated.length} of ${MANUALS.length} PDFs generated.`);
console.log(`Output: ${OUTPUT_DIR}`);

if (generated.length < MANUALS.length) {
  console.log('\nSome PDFs failed. Check the error messages above.');
  console.log('Common causes:');
  console.log('  - Chrome not installed (install from https://www.google.com/chrome/)');
  console.log('  - Manual .md file not found in manuals/ directory');
}
