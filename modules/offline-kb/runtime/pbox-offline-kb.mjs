#!/usr/bin/env node
// pbox-offline-kb.mjs -- Pandoras Box offline knowledge wrapper
//
// Thin reverse proxy + branded UI around a local Kiwix container. Operator
// searches Wikipedia / Wiktionary / Stack Overflow ZIM packs offline.
//
// Endpoints:
//   GET  /                  branded landing page (search box + recent searches)
//   GET  /api/search?q=X    JSON proxy to Kiwix search; logs query
//   GET  /api/recent        last 50 searches (JSON)
//   GET  /proxy/*           raw pass-through to Kiwix (for article reads)
//
// Hard constraints:
//   - Bind 127.0.0.1 by default. Tailscale fronts remote access.
//   - No shell. No write endpoints besides the implicit search log.
//   - Query length-capped at 200 chars; URL-encoded before proxying.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.OFFLINE_KB_PORT || '8090', 10)
const BIND = process.env.OFFLINE_KB_BIND || '127.0.0.1'
const KIWIX_HOST = process.env.KIWIX_HOST || '127.0.0.1'
const KIWIX_PORT = parseInt(process.env.KIWIX_INTERNAL_PORT || '8089', 10)

const SYSTEM_NAME = process.env.SYSTEM_NAME || 'Pandoras Box'
const COLOR_ACCENT = process.env.COLOR_ACCENT || '#c9a227'
const COLOR_BACKGROUND = process.env.COLOR_BACKGROUND || '#0f1115'
const COLOR_TEXT = process.env.COLOR_TEXT || '#e8e8e8'

const STORE_DIR = path.join(INSTALL_PATH, 'offline-kb', 'store')
const DB_PATH = path.join(STORE_DIR, 'searches.db')
const MAX_Q_LEN = 200

// Search log -- operator-owned, never network-exported.
try { fs.mkdirSync(STORE_DIR, { recursive: true }) } catch {}
const db = new DatabaseSync(DB_PATH)
db.exec(`CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT NOT NULL,
  ts INTEGER NOT NULL,
  results_count INTEGER NOT NULL
)`)
const insertSearch = db.prepare('INSERT INTO searches (q, ts, results_count) VALUES (?, ?, ?)')
const selectRecent = db.prepare('SELECT q, ts, results_count FROM searches ORDER BY id DESC LIMIT 50')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sanitiseQuery(raw) {
  if (typeof raw !== 'string') return ''
  // Strip control chars; cap length. Anything else is fine because we
  // URL-encode before forwarding to Kiwix.
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return cleaned.slice(0, MAX_Q_LEN)
}

function kiwixGet(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: KIWIX_HOST,
      port: KIWIX_PORT,
      path: pathAndQuery,
      method: 'GET',
      timeout: 10000,
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('timeout', () => { req.destroy(new Error('kiwix timeout')) })
    req.on('error', reject)
    req.end()
  })
}

function streamKiwix(req, res, upstreamPath) {
  // Pipe-style pass-through for /proxy/* article reads. Avoids buffering large pages.
  const upstream = http.request({
    host: KIWIX_HOST,
    port: KIWIX_PORT,
    path: upstreamPath,
    method: 'GET',
    headers: { 'accept': req.headers['accept'] || '*/*' },
    timeout: 15000,
  }, (uRes) => {
    res.writeHead(uRes.statusCode || 502, uRes.headers)
    uRes.pipe(res)
  })
  upstream.on('timeout', () => { upstream.destroy(new Error('kiwix timeout')) })
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('upstream error') })
  upstream.end()
}

// Best-effort parse of Kiwix search HTML into structured results.
// Kiwix's /search renders an unordered list of <a> with title + snippet.
function parseKiwixResults(html) {
  const out = []
  const itemRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>(?:[\s\S]{0,400}?<cite[^>]*>([\s\S]*?)<\/cite>)?/gi
  let m
  while ((m = itemRe.exec(html)) !== null && out.length < 25) {
    const url = m[1]
    if (!url || url.startsWith('#')) continue
    out.push({
      title: m[2].replace(/\s+/g, ' ').trim(),
      url,
      snippet: (m[3] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
function renderLanding(recent) {
  const recentHtml = recent.length === 0
    ? '<li class="empty">No searches yet.</li>'
    : recent.map(r => {
        const when = new Date(r.ts).toISOString().replace('T', ' ').slice(0, 16)
        const q = escapeHtml(r.q)
        return `<li><a href="/?q=${encodeURIComponent(r.q)}">${q}</a><span class="meta">${r.results_count} hits &middot; ${when}</span></li>`
      }).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(SYSTEM_NAME)} - Offline Knowledge</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --accent: ${COLOR_ACCENT}; --bg: ${COLOR_BACKGROUND}; --fg: ${COLOR_TEXT}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; }
  header { padding: 40px 32px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  header h1 { margin: 0; font-size: 1.6rem; letter-spacing: 0.02em; }
  header h1 .accent { color: var(--accent); }
  header p { margin: 6px 0 0; opacity: 0.7; font-size: 0.9rem; }
  main { padding: 32px; max-width: 920px; margin: 0 auto; }
  form.search { display: flex; gap: 8px; margin-bottom: 32px; }
  form.search input[type=text] {
    flex: 1; padding: 14px 16px; font-size: 1rem; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.04); color: var(--fg);
  }
  form.search button {
    padding: 0 22px; font-size: 1rem; border: 0; border-radius: 6px;
    background: var(--accent); color: #111; font-weight: 600; cursor: pointer;
  }
  .results { list-style: none; padding: 0; margin: 0; }
  .results li { padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .results a.title { color: var(--accent); font-size: 1.05rem; text-decoration: none; }
  .results a.title:hover { text-decoration: underline; }
  .results .snippet { display: block; margin-top: 4px; opacity: 0.78; font-size: 0.9rem; }
  .results .url { display: block; margin-top: 2px; opacity: 0.45; font-size: 0.78rem; word-break: break-all; }
  section.recent { margin-top: 40px; }
  section.recent h2 { font-size: 0.85rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6; }
  section.recent ul { list-style: none; padding: 0; margin: 0; }
  section.recent li { padding: 6px 0; display: flex; justify-content: space-between; font-size: 0.88rem; }
  section.recent li.empty { opacity: 0.45; }
  section.recent a { color: var(--fg); text-decoration: none; }
  section.recent a:hover { color: var(--accent); }
  section.recent .meta { opacity: 0.45; font-size: 0.78rem; }
  .empty-state { opacity: 0.55; padding: 20px 0; }
</style></head>
<body>
<header>
  <h1>${escapeHtml(SYSTEM_NAME)} <span class="accent">- Offline Knowledge</span></h1>
  <p>Local search across installed ZIM packs. No network egress.</p>
</header>
<main>
  <form class="search" method="get" action="/">
    <input type="text" name="q" id="q" placeholder="Search Wikipedia, Wiktionary, Stack Overflow..." maxlength="${MAX_Q_LEN}" autofocus>
    <button type="submit">Search</button>
  </form>
  <ul class="results" id="results"></ul>
  <div class="empty-state" id="empty">Enter a query above. Results stay on this machine.</div>
  <section class="recent">
    <h2>Recent searches</h2>
    <ul>${recentHtml}</ul>
  </section>
</main>
<script>
  // Render results client-side from /api/search so the URL is shareable + the search log entry is created.
  const params = new URLSearchParams(location.search)
  const q = params.get('q')
  if (q) {
    document.getElementById('q').value = q
    document.getElementById('empty').textContent = 'Searching...'
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(r => r.json())
      .then(data => {
        const ul = document.getElementById('results')
        document.getElementById('empty').style.display = 'none'
        if (!data.results || data.results.length === 0) {
          document.getElementById('empty').style.display = 'block'
          document.getElementById('empty').textContent = 'No results.'
          return
        }
        ul.innerHTML = data.results.map(r => {
          const esc = (v) => (v || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
          const t = esc(r.title)
          const s = esc(r.snippet)
          const u = esc(r.url)
          const href = '/proxy' + (u.startsWith('/') ? u : '/' + u)
          return '<li><a class="title" href="' + href + '">' + t + '</a><span class="snippet">' + s + '</span><span class="url">' + u + '</span></li>'
        }).join('')
      })
      .catch(() => {
        document.getElementById('empty').style.display = 'block'
        document.getElementById('empty').textContent = 'Search failed. Is the Kiwix container running?'
      })
  }
</script>
</body></html>`
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  let url
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`) }
  catch { res.writeHead(400); res.end('bad url'); return }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' }); res.end('method not allowed'); return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const recent = selectRecent.all()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(renderLanding(recent))
    return
  }

  if (url.pathname === '/api/recent') {
    const recent = selectRecent.all()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ recent }))
    return
  }

  if (url.pathname === '/api/search') {
    const q = sanitiseQuery(url.searchParams.get('q') || '')
    if (!q) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'q required' })); return }
    try {
      const upstream = await kiwixGet(`/search?pattern=${encodeURIComponent(q)}&pageLength=25`)
      const html = upstream.body.toString('utf8')
      const results = parseKiwixResults(html)
      try { insertSearch.run(q, Date.now(), results.length) } catch {}
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ q, results }))
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream', detail: String(err && err.message || err) }))
    }
    return
  }

  if (url.pathname.startsWith('/proxy/')) {
    // Strip the /proxy prefix; forward path + querystring verbatim.
    const upstreamPath = url.pathname.slice('/proxy'.length) + (url.search || '')
    streamKiwix(req, res, upstreamPath || '/')
    return
  }

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, BIND, () => {
  console.log(`[offline-kb] listening on http://${BIND}:${PORT}`)
  console.log(`[offline-kb] kiwix upstream http://${KIWIX_HOST}:${KIWIX_PORT}`)
  console.log(`[offline-kb] search log ${DB_PATH}`)
})

function shutdown() {
  try { db.close() } catch {}
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
