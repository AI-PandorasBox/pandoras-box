#!/usr/bin/env node
// pbox-terminal.mjs -- Pandoras Box localhost log-viewer + restart helper
//
// Minimal v0.3 scope: read-only log tail + per-service restart button.
// Browser UI on localhost:$TERMINAL_PORT (default 8484).
//
// Auth: PBKDF2-hashed passphrase set in TERMINAL_PASSPHRASE_HASH (.env).
//       Single-session cookie. Localhost-only by default.
// Security: NO arbitrary shell exec. Restart endpoint uses execFile with
//           a label allowlist derived from launchctl list output.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.TERMINAL_PORT || '8484', 10)
const BIND = process.env.TERMINAL_BIND || '127.0.0.1'
const PASS_HASH = process.env.TERMINAL_PASSPHRASE_HASH || ''
const SESSION_TTL_MS = 1000 * 60 * 60  // 1 hour

function readThemePrefix() {
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = conf.match(/^LAUNCHDAEMON_PREFIX=["']?([^"'\n]+)["']?$/m)
    return m ? m[1] : 'com.pandoras-box'
  } catch { return 'com.pandoras-box' }
}
function readLogPrefix() {
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = conf.match(/^LOG_PREFIX=["']?([^"'\n]+)["']?$/m)
    return m ? m[1] : 'pandoras-box'
  } catch { return 'pandoras-box' }
}
const PREFIX = readThemePrefix()
const LOG_PREFIX = readLogPrefix()

const sessions = new Map()  // token -> expires_at_ms

function hashPbkdf2(plain, salt) {
  return crypto.pbkdf2Sync(plain, salt, 200000, 32, 'sha256').toString('hex')
}

function verifyPassphrase(plain) {
  if (!PASS_HASH) return false
  const [salt, hash] = PASS_HASH.split(':')
  if (!salt || !hash) return false
  return crypto.timingSafeEqual(Buffer.from(hashPbkdf2(plain, salt), 'hex'), Buffer.from(hash, 'hex'))
}

function newSession() {
  const t = crypto.randomBytes(32).toString('hex')
  sessions.set(t, Date.now() + SESSION_TTL_MS)
  return t
}
function validSession(req) {
  const cookie = req.headers.cookie || ''
  const m = cookie.match(/term_sess=([a-f0-9]+)/)
  if (!m) return false
  const exp = sessions.get(m[1])
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return false }
  return true
}

// Allowed service labels: discovered from launchctl list filtered by prefix.
function allowedLabels() {
  try {
    const raw = execFileSync('launchctl', ['list'], { encoding: 'utf8', timeout: 3000 })
    const labels = new Set()
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 3 && parts[2] && parts[2].startsWith(PREFIX + '.')) labels.add(parts[2])
    }
    return labels
  } catch { return new Set() }
}

function tailLog(file, lines = 200) {
  try {
    const stat = fs.statSync(file)
    const size = stat.size
    const start = Math.max(0, size - 32768)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const all = buf.toString('utf8').split('\n')
    return all.slice(-lines).join('\n')
  } catch (e) { return `(no log: ${e.message})` }
}

// ---------------------------------------------------------------------------
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function renderLogin(error='') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Terminal -- sign in</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a14;color:#eee;margin:0}
form{background:#14141f;padding:32px;border-radius:8px;width:320px}h1{margin:0 0 16px;font-size:1.2rem}
input{width:100%;padding:10px;background:#0a0a14;border:1px solid #2a2a40;border-radius:4px;color:#eee;box-sizing:border-box;font-size:14px}
button{margin-top:12px;width:100%;padding:10px;background:#00B4FF;border:none;border-radius:4px;color:#0a0a14;font-weight:600;cursor:pointer}
.err{color:#ff6b6b;font-size:13px;margin-top:8px}</style></head>
<body><form method="POST" action="/login"><h1>Pandoras Box Terminal</h1>
<input name="passphrase" type="password" placeholder="Passphrase" autofocus required>
<button type="submit">Sign in</button>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}</form></body></html>`
}

function renderApp() {
  const labels = [...allowedLabels()].sort()
  const labelOptions = labels.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Terminal</title>
<style>body{font-family:-apple-system,sans-serif;margin:0;background:#0a0a14;color:#eee}
header{background:#14141f;padding:14px 24px;border-bottom:1px solid #2a2a40;display:flex;align-items:center;gap:24px}
h1{margin:0;font-size:1rem}select,button{background:#0a0a14;color:#eee;border:1px solid #2a2a40;padding:8px 12px;border-radius:4px;font-size:13px}
button{cursor:pointer}button.primary{background:#00B4FF;color:#0a0a14;font-weight:600;border:none}
button.danger{background:#ff6b6b;color:#0a0a14;font-weight:600;border:none}
pre{margin:0;padding:24px 32px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all;height:calc(100vh - 60px);overflow-y:auto;background:#0a0a14}
.muted{color:#888;font-size:12px}</style></head>
<body><header>
<h1>Terminal</h1>
<select id="svc"><option value="">-- pick a service --</option>${labelOptions}</select>
<button id="tail" class="primary">Tail log</button>
<button id="restart" class="danger">Restart selected</button>
<span class="muted" id="status"></span>
</header><pre id="out">Pick a service and click Tail log.</pre>
<script>
const svc = document.getElementById('svc'), out = document.getElementById('out'), st = document.getElementById('status')
let timer = null
async function tailNow() {
  if (!svc.value) return
  st.textContent = 'fetching...'
  const r = await fetch('/api/tail?label=' + encodeURIComponent(svc.value))
  out.textContent = r.ok ? await r.text() : 'fetch error ' + r.status
  out.scrollTop = out.scrollHeight
  st.textContent = 'updated ' + new Date().toLocaleTimeString()
}
document.getElementById('tail').onclick = () => { tailNow(); if (timer) clearInterval(timer); timer = setInterval(tailNow, 3000) }
document.getElementById('restart').onclick = async () => {
  if (!svc.value) return
  if (!confirm('Restart ' + svc.value + '?')) return
  const r = await fetch('/api/restart?label=' + encodeURIComponent(svc.value), { method: 'POST' })
  st.textContent = r.ok ? 'restarted' : 'restart failed ' + r.status
}
</script></body></html>`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        const pass = decodeURIComponent((body.match(/passphrase=([^&]*)/) || ['',''])[1] || '').replace(/\+/g,' ')
        if (verifyPassphrase(pass)) {
          const t = newSession()
          res.writeHead(302, { 'set-cookie': `term_sess=${t}; HttpOnly; Path=/; Max-Age=3600`, location: '/' })
          res.end()
        } else {
          res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderLogin('Wrong passphrase.'))
        }
      })
      return
    }
    if (url.pathname === '/' && !validSession(req)) {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderLogin())
      return
    }
    if (url.pathname === '/') {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderApp())
      return
    }
    if (!validSession(req)) { res.writeHead(401); res.end('unauthorized'); return }

    if (url.pathname === '/api/tail') {
      const label = url.searchParams.get('label') || ''
      if (!allowedLabels().has(label)) { res.writeHead(404); res.end('unknown label'); return }
      const suffix = label.slice(PREFIX.length + 1)
      const file = `/tmp/${LOG_PREFIX}-${suffix}.log`
      res.writeHead(200, {'content-type':'text/plain; charset=utf-8'})
      res.end(tailLog(file))
      return
    }
    if (url.pathname === '/api/restart' && req.method === 'POST') {
      const label = url.searchParams.get('label') || ''
      if (!allowedLabels().has(label)) { res.writeHead(404); res.end('unknown label'); return }
      try {
        execFileSync('launchctl', ['stop', label], { timeout: 5000 })
        execFileSync('launchctl', ['start', label], { timeout: 5000 })
        res.writeHead(200); res.end('ok')
      } catch (e) { res.writeHead(500); res.end(`restart failed: ${e.message}`) }
      return
    }
    res.writeHead(404); res.end('not found')
  } catch (e) { res.writeHead(500); res.end(`error: ${e.message}`) }
})

server.listen(PORT, BIND, () => {
  console.log(`[terminal] listening on http://${BIND}:${PORT}`)
  console.log(`[terminal] install path: ${INSTALL_PATH}`)
  if (!PASS_HASH) console.log(`[terminal] WARNING: TERMINAL_PASSPHRASE_HASH not set; login will always fail`)
})
