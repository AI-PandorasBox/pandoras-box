#!/usr/bin/env node
// pbox-admin-lite.mjs -- mobile-friendly admin panel
// PIN-locked status / restart UI optimised for phone screens. Localhost-only
// by default; expose via Tailscale for off-LAN access.
// Security: PBKDF2 PIN hash, sessions, execFile-only restart, label allowlist.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.ADMIN_LITE_PORT || '8488', 10)
const BIND = process.env.ADMIN_LITE_BIND || '127.0.0.1'
const PIN_HASH = process.env.ADMIN_LITE_PIN_HASH || ''
const SESSION_TTL_MS = 1000 * 60 * 30  // 30 min

function readThemePrefix() {
  try {
    const c = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = c.match(/^LAUNCHDAEMON_PREFIX=["']?([^"'\n]+)["']?$/m)
    return m ? m[1] : 'com.pandoras-box'
  } catch { return 'com.pandoras-box' }
}
const PREFIX = readThemePrefix()

const sessions = new Map()
const pinFails = new Map()  // ip -> {count, lockoutUntil}

function hashPbkdf2(plain, salt) {
  return crypto.pbkdf2Sync(plain, salt, 200000, 32, 'sha256').toString('hex')
}
function verifyPin(plain) {
  if (!PIN_HASH) return false
  const [salt, hash] = PIN_HASH.split(':')
  if (!salt || !hash) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(hashPbkdf2(plain, salt), 'hex'), Buffer.from(hash, 'hex'))
  } catch { return false }
}
function ipOf(req) { return req.socket.remoteAddress || 'unknown' }
function lockedOut(ip) {
  const e = pinFails.get(ip); return e && e.lockoutUntil > Date.now()
}
function recordFail(ip) {
  const e = pinFails.get(ip) || { count: 0, lockoutUntil: 0 }
  e.count++
  if (e.count >= 5) e.lockoutUntil = Date.now() + 1000 * 60 * 5
  pinFails.set(ip, e)
}
function recordSuccess(ip) { pinFails.delete(ip) }

function newSession() { const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, Date.now() + SESSION_TTL_MS); return t }
function validSession(req) {
  const c = req.headers.cookie || ''
  const m = c.match(/al_sess=([a-f0-9]+)/)
  if (!m) return false
  const exp = sessions.get(m[1])
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return false }
  return true
}

function allowedLabels() {
  try {
    const raw = execFileSync('launchctl', ['list'], { encoding: 'utf8', timeout: 3000 })
    const labels = []
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 3 || !parts[2]) continue
      if (!parts[2].startsWith(PREFIX + '.')) continue
      labels.push({
        label: parts[2],
        pid: parts[0] === '-' ? null : parseInt(parts[0], 10),
        running: parts[0] !== '-' && parts[0] !== '0',
      })
    }
    return labels
  } catch { return [] }
}

function renderPin(err='') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Lite</title><style>
body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a14;color:#eee;margin:0}
form{background:#14141f;padding:32px;border-radius:8px;width:280px;text-align:center}
h1{margin:0 0 16px;font-size:1.2rem}
input{width:100%;padding:14px;background:#0a0a14;border:1px solid #2a2a40;border-radius:6px;color:#eee;font-size:18px;text-align:center;letter-spacing:.3em;box-sizing:border-box}
button{margin-top:12px;width:100%;padding:14px;background:#00B4FF;border:none;border-radius:6px;color:#0a0a14;font-weight:600;font-size:16px;cursor:pointer}
.err{color:#ff6b6b;font-size:13px;margin-top:8px}</style></head>
<body><form method="POST" action="/login"><h1>Admin Lite</h1>
<input name="pin" type="password" pattern="[0-9]*" inputmode="numeric" maxlength="12" placeholder="PIN" autofocus required>
<button type="submit">Unlock</button>
${err ? `<div class="err">${err.replace(/[<>]/g,'')}</div>` : ''}</form></body></html>`
}

function renderApp() {
  const labels = allowedLabels()
  const rows = labels.map(l => {
    const colour = l.running ? '#0a0' : '#c00'
    return `<div class="svc">
  <div><strong>${l.label.replace(PREFIX+'.','')}</strong><br><span style="color:#888;font-size:11px">${l.label}</span></div>
  <div><span style="color:${colour}">${l.running ? 'RUNNING' : 'STOPPED'}</span> ${l.pid?`<span style="color:#888">pid ${l.pid}</span>`:''}</div>
  <button class="restart" data-label="${l.label}">Restart</button>
</div>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Lite</title><style>
body{font-family:-apple-system,sans-serif;background:#0a0a14;color:#eee;margin:0;padding:16px}
h1{font-size:1.1rem;margin:8px 0 20px}
.svc{background:#14141f;padding:14px;border-radius:6px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px}
.svc button{background:#ff6b6b;color:#0a0a14;border:none;padding:8px 14px;border-radius:4px;font-weight:600;font-size:12px;cursor:pointer}
#status{position:fixed;bottom:0;left:0;right:0;background:#14141f;padding:10px 16px;font-size:12px;color:#888;border-top:1px solid #2a2a40}</style></head>
<body><h1>Pandoras Box -- Admin Lite</h1>${rows||'<p style="color:#888">No services registered.</p>'}
<div id="status">Pull-to-refresh or wait 10s</div>
<script>
let refTimer=setInterval(()=>location.reload(),10000)
document.querySelectorAll('.restart').forEach(b=>b.onclick=async()=>{
  const lbl=b.dataset.label; if(!confirm('Restart '+lbl+'?'))return
  const r=await fetch('/api/restart?label='+encodeURIComponent(lbl),{method:'POST'})
  document.getElementById('status').textContent=r.ok?'restarted '+lbl:'restart failed: '+r.status
  setTimeout(()=>location.reload(),1500)
})
</script></body></html>`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const ip = ipOf(req)
  try {
    if (url.pathname === '/login' && req.method === 'POST') {
      if (lockedOut(ip)) { res.writeHead(429); res.end('locked out'); return }
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        const pin = decodeURIComponent((body.match(/pin=([^&]*)/) || ['',''])[1] || '').replace(/\+/g,' ')
        if (verifyPin(pin)) {
          recordSuccess(ip)
          const t = newSession()
          res.writeHead(302, { 'set-cookie': `al_sess=${t}; HttpOnly; Path=/; Max-Age=1800`, location: '/' }); res.end()
        } else {
          recordFail(ip)
          res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderPin('Wrong PIN.'))
        }
      })
      return
    }
    if (url.pathname === '/' && !validSession(req)) {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderPin()); return
    }
    if (url.pathname === '/') {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderApp()); return
    }
    if (!validSession(req)) { res.writeHead(401); res.end('unauthorized'); return }

    if (url.pathname === '/api/restart' && req.method === 'POST') {
      const label = url.searchParams.get('label') || ''
      const allowed = allowedLabels().map(l => l.label)
      if (!allowed.includes(label)) { res.writeHead(404); res.end('unknown label'); return }
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
  console.log(`[admin-lite] listening on http://${BIND}:${PORT}`)
  if (!PIN_HASH) console.log(`[admin-lite] WARNING: ADMIN_LITE_PIN_HASH not set; login will fail`)
})
