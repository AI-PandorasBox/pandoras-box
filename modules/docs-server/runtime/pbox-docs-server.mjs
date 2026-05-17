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

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; display: flex; min-height: 100vh; }
  aside { width: 280px; background: #f5f5f5; padding: 24px; border-right: 1px solid #ddd; overflow-y: auto; font-size: 14px; }
  aside h3 { margin: 16px 0 8px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #888; }
  aside ul { list-style: none; padding: 0; margin: 0; }
  aside li { margin: 0 0 4px; }
  aside a { color: #333; text-decoration: none; }
  aside a:hover { text-decoration: underline; }
  aside li.active a { font-weight: 600; color: #06f; }
  main { flex: 1; padding: 40px 56px; max-width: 920px; line-height: 1.55; }
  main h1, main h2, main h3, main h4 { line-height: 1.2; }
  main h1 { font-size: 2.2rem; border-bottom: 2px solid #eee; padding-bottom: 12px; }
  main h2 { margin-top: 36px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  main pre { background: #f6f8fa; padding: 14px 18px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
  main code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
  main p code, main li code { background: #f1f1f1; padding: 1px 5px; border-radius: 3px; }
  main table { border-collapse: collapse; margin: 16px 0; }
  main table th, main table td { padding: 8px 14px; border: 1px solid #ddd; text-align: left; }
  main table th { background: #f6f8fa; font-weight: 600; }
  main blockquote { border-left: 3px solid #06f; padding: 4px 16px; color: #555; margin: 12px 0; background: #f9f9fb; }
  main hr { border: none; border-top: 1px solid #e0e0e0; margin: 28px 0; }
  main a { color: #06f; }
</style></head>
<body>
<aside><h2 style="margin:0 0 20px;font-size:1.1rem">Pandoras Box Docs</h2>${navHtml}</aside>
<main>${contentHtml}</main>
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
  if (url.pathname === '/') {
    const intro = `# Pandoras Box Documentation\n\nUse the sidebar to navigate the manuals and architecture docs.\n\nFor the latest release notes and live install, see [ai-pandorasbox.co.uk](https://ai-pandorasbox.co.uk).\n`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(renderPage('Pandoras Box Docs', renderMarkdown(intro), '/'))
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
