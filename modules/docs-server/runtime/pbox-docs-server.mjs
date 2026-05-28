#!/usr/bin/env node
// pbox-docs-server.mjs -- Pandoras Box local documentation server
//
// Serves the markdown files under $INSTALL_PATH/manuals/ and $INSTALL_PATH/docs/
// as a navigable website on http://localhost:$DOCS_PORT (default 8485).
//
// Scope (intentionally minimal):
//   - Read-only HTTP server, localhost-only by default
//   - Markdown -> HTML via a lightweight inline renderer (no external deps
//     beyond Node built-ins)
//   - Sidebar nav auto-discovered from manuals/ + docs/
//   - Path-traversal protected: only files under the configured roots are served
//   - No write endpoints, no shell exec, no user-uploaded content
//
// Not in scope (do not add without security review):
//   - Build / deploy orchestration (admin-agent-side concern)
//   - Authentication (this is localhost-only; bind 127.0.0.1)
//   - Editing of served files

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.DOCS_PORT || '8485', 10)
const BIND = process.env.DOCS_BIND || '127.0.0.1'

// Allowed roots. Path-traversal protection enforced by realpath checks.
const ROOTS = [
  path.join(INSTALL_PATH, 'manuals'),
  path.join(INSTALL_PATH, 'docs'),
].filter(d => {
  try { return fs.statSync(d).isDirectory() } catch { return false }
})

if (ROOTS.length === 0) {
  console.error(`[docs-server] No doc roots found under ${INSTALL_PATH}/{manuals,docs}/`)
  process.exit(1)
}

const REAL_ROOTS = ROOTS.map(d => fs.realpathSync(d))

// ---------------------------------------------------------------------------
// Markdown -> HTML (minimal, dependency-free)
// Covers: headings, paragraphs, fenced code blocks, inline code, links,
// bold/italic, unordered + ordered lists, blockquotes, horizontal rules,
// tables, line breaks. Not a full CommonMark renderer -- intentionally small.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInline(s) {
  s = escapeHtml(s)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  return s
}

function renderMarkdown(md) {
  const lines = md.split('\n')
  const out = []
  let inCode = false
  let codeLang = ''
  let inList = false
  let listType = ''
  let inTable = false

  const flushList = () => { if (inList) { out.push(`</${listType}>`); inList = false; listType = '' } }
  const flushTable = () => { if (inTable) { out.push('</tbody></table>'); inTable = false } }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Fenced code
    const fence = line.match(/^```(\w*)$/)
    if (fence) {
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
        codeLang = ''
      } else {
        flushList(); flushTable()
        codeLang = fence[1] || ''
        out.push(`<pre class="lang-${escapeHtml(codeLang)}"><code>`)
        inCode = true
      }
      continue
    }
    if (inCode) { out.push(escapeHtml(line)); continue }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) { flushList(); flushTable(); out.push('<hr>'); continue }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushList(); flushTable()
      const lvl = h[1].length
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`)
      continue
    }

    // Tables (very simple: line of |...|...|, next line of separator |---|---|)
    if (line.startsWith('|') && lines[i+1] && /^\|[\s:|-]+\|$/.test(lines[i+1])) {
      flushList()
      if (!inTable) { out.push('<table><thead><tr>'); inTable = true }
      const cells = line.slice(1, -1).split('|').map(c => `<th>${renderInline(c.trim())}</th>`)
      out.push(cells.join('') + '</tr></thead><tbody>')
      i++ // skip the |---| separator
      continue
    }
    if (inTable && line.startsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(c => `<td>${renderInline(c.trim())}</td>`)
      out.push('<tr>' + cells.join('') + '</tr>')
      continue
    }
    if (inTable) flushTable()

    // Unordered list
    const ul = line.match(/^[-*]\s+(.+)$/)
    if (ul) {
      if (!inList || listType !== 'ul') { flushList(); out.push('<ul>'); inList = true; listType = 'ul' }
      out.push(`<li>${renderInline(ul[1])}</li>`)
      continue
    }
    // Ordered list
    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      if (!inList || listType !== 'ol') { flushList(); out.push('<ol>'); inList = true; listType = 'ol' }
      out.push(`<li>${renderInline(ol[1])}</li>`)
      continue
    }
    if (inList && line.trim() === '') { flushList(); continue }

    // Blockquote
    if (line.startsWith('> ')) {
      out.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`)
      continue
    }

    // Paragraph or blank
    if (line.trim() === '') { out.push(''); continue }
    out.push(`<p>${renderInline(line)}</p>`)
  }
  if (inCode) out.push('</code></pre>')
  flushList(); flushTable()
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Navigation discovery
// ---------------------------------------------------------------------------
function walkMarkdown(root) {
  const out = []
  function recurse(dir, rel) {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const relPath = path.join(rel, e.name)
      if (e.isDirectory()) { recurse(full, relPath) }
      else if (e.isFile() && e.name.endsWith('.md')) { out.push(relPath) }
    }
  }
  recurse(root, '')
  return out
}

function buildNav() {
  const nav = []
  for (const root of ROOTS) {
    const label = path.basename(root)
    const files = walkMarkdown(root)
    nav.push({ section: label, root, files })
  }
  return nav
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const NAV = buildNav()

function renderPage(title, contentHtml, currentPath) {
  const navHtml = NAV.map(s => {
    const items = s.files.map(f => {
      const href = `/view?root=${encodeURIComponent(s.section)}&file=${encodeURIComponent(f)}`
      const active = (currentPath === href) ? ' class="active"' : ''
      return `<li${active}><a href="${href}">${escapeHtml(f.replace(/\.md$/, ''))}</a></li>`
    }).join('')
    return `<div class="nav-section"><h3>${escapeHtml(s.section)}</h3><ul>${items}</ul></div>`
  }).join('')

  // Design tokens match the dashboard so Docs and Dashboard feel like one app.
  // _DOCS_UI_V2 — design ported from the Mac internal pbox-docs-server.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} · Pandoras Box Docs</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0a14;--bg-deep:#07070f;--elev:#14141f;--surface:#1f1f2e;
  --rule:#2a2a40;--fg:#f0f0ff;--fg-soft:#c8c8e0;--muted:#8888aa;
  --brand:#7B68EE;--cyan:#00B4FF;--gold:#FFD700;--green:#7BFF7B;
  --grad-spec:linear-gradient(120deg,var(--brand),var(--cyan) 50%,var(--gold));
  --font:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --sw:260px;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:var(--font);font-weight:300;background:var(--bg);color:var(--fg);display:flex;min-height:100vh;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(900px 600px at 82% -10%,rgba(123,104,238,.18),transparent 60%),radial-gradient(760px 520px at 8% 108%,rgba(0,180,255,.10),transparent 60%)}

aside{width:var(--sw);background:var(--bg-deep);border-right:1px solid var(--rule);padding:24px 18px;overflow-y:auto;font-size:13px;position:sticky;top:0;height:100vh;z-index:2}
aside .brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--rule)}
aside .brand .logo{width:26px;height:26px;flex:none}
aside .brand .name{font-family:var(--font);font-weight:700;font-size:13.5px;letter-spacing:1px;background:var(--grad-spec);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
aside .home{display:block;font-family:var(--mono);font-size:11px;color:var(--muted);text-decoration:none;padding:6px 8px;border-radius:5px;margin-bottom:14px}
aside .home:hover{color:var(--cyan);background:var(--elev)}
aside h3{margin:18px 8px 8px;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);font-weight:600}
aside ul{list-style:none}
aside li{margin:0}
aside li a{display:block;color:var(--fg-soft);text-decoration:none;padding:6px 10px;border-radius:5px;font-size:12.5px;line-height:1.45;font-family:var(--mono)}
aside li a:hover{background:var(--elev);color:var(--cyan)}
aside li.active a{background:var(--surface);color:var(--fg);font-weight:500;border-left:2px solid var(--brand);padding-left:10px}

main{flex:1;padding:48px clamp(24px,5vw,72px);max-width:980px;line-height:1.6;position:relative;z-index:1}
main h1,main h2,main h3,main h4,main h5,main h6{font-family:var(--font);font-weight:600;line-height:1.2;color:var(--fg)}
main h1{font-size:clamp(26px,4vw,36px);letter-spacing:-.6px;padding-bottom:14px;border-bottom:1px solid var(--rule);margin-bottom:20px}
main h2{font-size:1.45rem;margin-top:42px;margin-bottom:14px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
main h3{font-size:1.15rem;margin-top:30px;margin-bottom:10px;color:var(--fg-soft)}
main h4{font-size:1rem;margin-top:22px;margin-bottom:8px;color:var(--fg-soft)}
main p{margin:0 0 14px;color:var(--fg-soft);font-size:14.5px}
main ul,main ol{margin:0 0 16px;padding-left:26px;color:var(--fg-soft);font-size:14.5px}
main li{margin-bottom:5px}
main a{color:var(--cyan);text-decoration:none;border-bottom:1px solid transparent;transition:.15s}
main a:hover{border-bottom-color:var(--cyan)}
main hr{border:none;border-top:1px solid var(--rule);margin:32px 0}

main pre{background:var(--bg-deep);border:1px solid var(--rule);padding:14px 18px;border-radius:8px;overflow-x:auto;font-family:var(--mono);font-size:12.5px;color:var(--fg-soft);margin:0 0 16px;line-height:1.55}
main pre code{background:none;border:none;padding:0;color:inherit;font-size:inherit}
main code{font-family:var(--mono);font-size:.92em;color:var(--gold)}
main p code,main li code,main td code,main h1 code,main h2 code,main h3 code,main h4 code{background:var(--elev);border:1px solid var(--rule);padding:1px 6px;border-radius:4px;color:var(--gold);font-weight:400}

main table{border-collapse:collapse;margin:18px 0;font-size:13.5px;width:100%;font-family:var(--font)}
main table th,main table td{padding:9px 14px;border:1px solid var(--rule);text-align:left;color:var(--fg-soft)}
main table th{background:var(--elev);color:var(--fg);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.5px}
main blockquote{border-left:3px solid var(--brand);padding:8px 16px;color:var(--fg-soft);margin:14px 0;background:rgba(123,104,238,.04);border-radius:0 4px 4px 0}
main strong{color:var(--fg);font-weight:600}
main em{color:var(--fg-soft);font-style:italic}
main img{max-width:100%;border-radius:6px;border:1px solid var(--rule)}

.meta{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:48px;padding-top:18px;border-top:1px solid var(--rule)}
.meta a{color:var(--cyan)}

@media(max-width:760px){aside{display:none}main{padding:24px 18px}}
</style></head>
<body>
<aside>
  <div class="brand">
    <svg class="logo" viewBox="0 0 64 64" fill="none">
      <ellipse cx="32" cy="26" rx="14" ry="10" fill="#7B68EE" opacity=".4"/>
      <path d="M14 30 L32 39 L32 52 L14 44 Z" fill="#3a2f6b" stroke="#6a5acd" stroke-width="1"/>
      <path d="M50 30 L32 39 L32 52 L50 44 Z" fill="#2c2356" stroke="#6a5acd" stroke-width="1"/>
      <path d="M14 30 L32 23 L50 30" fill="none" stroke="#fff" stroke-width="2"/>
      <circle cx="32" cy="27" r="2.4" fill="#FFD700"/>
      <path d="M16 19 L32 12 L48 19 L32 26 Z" fill="#7B68EE"/>
    </svg>
    <span class="name">PANDORAS BOX · DOCS</span>
  </div>
  <a class="home" href="/">← Home</a>
  ${navHtml}
</aside>
<main>${contentHtml}
<div class="meta">Served locally · <a href="/api/health">health</a></div>
</main>
</body></html>`
}

function safeResolve(rootLabel, relFile) {
  // Find root by label
  const root = ROOTS.find(r => path.basename(r) === rootLabel)
  if (!root) return null
  const real = REAL_ROOTS[ROOTS.indexOf(root)]
  // Join + realpath + check prefix
  const candidate = path.join(real, relFile)
  let resolved
  try { resolved = fs.realpathSync(candidate) } catch { return null }
  if (!resolved.startsWith(real + path.sep) && resolved !== real) return null
  if (!resolved.endsWith('.md')) return null
  return resolved
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, files: NAV.reduce((a, s) => a + s.files.length, 0), time: new Date().toISOString() }))
    return
  }
  if (url.pathname === '/') {
    const intro = `# Pandoras Box Documentation\n\nLocal documentation server. Browse the manuals and architecture docs from the sidebar on the left.\n\n## What lives here\n\n- **manuals/** — installation guides, operator handbook, FAQ.\n- **docs/** — architecture references, module specs, deeper internals.\n\nThis server is read-only and bound to localhost. For the latest release notes and downloads, see [ai-pandorasbox.co.uk](https://ai-pandorasbox.co.uk).\n`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(renderPage('Home', renderMarkdown(intro), '/'))
    return
  }
  if (url.pathname === '/view') {
    const rootLabel = url.searchParams.get('root') || ''
    const relFile = url.searchParams.get('file') || ''
    const resolved = safeResolve(rootLabel, relFile)
    if (!resolved) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return }
    let md
    try { md = fs.readFileSync(resolved, 'utf8') } catch { res.writeHead(500); res.end('read failed'); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(renderPage(relFile, renderMarkdown(md), req.url))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, BIND, () => {
  console.log(`[docs-server] listening on http://${BIND}:${PORT}`)
  console.log(`[docs-server] roots: ${ROOTS.join(', ')}`)
  console.log(`[docs-server] ${NAV.reduce((a, s) => a + s.files.length, 0)} markdown files indexed`)
})
