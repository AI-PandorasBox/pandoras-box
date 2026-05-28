#!/usr/bin/env node
// pbox-dashboard.mjs -- Pandoras Box dashboard
// Localhost-only HTTP server. GET / for HTML, /api/status + /api/health for JSON.
// Security: execFile only (no shell). Theme values from theme.conf are
// operator-controlled and HTML-escaped before render; never shell-interpolated.
// _DASHBOARD_UI_V2: branded UI (chest mark, theme accent, mobile-responsive),
// rendered from live data (installed modules + service health + update status).

import http from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.DASHBOARD_PORT || '8181', 10)
const BIND = process.env.DASHBOARD_BIND || '127.0.0.1'

// --- theme -----------------------------------------------------------------
function readTheme() {
  const t = {
    prefix: 'com.pandoras-box', system: 'Pandora’s Box',
    admin: 'Admin', assistant: 'Assistant', overseer: 'Oversight',
    accent: '#7B68EE',
  }
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const g = (k) => { const m = conf.match(new RegExp('^' + k + '=["\']?([^"\'\\n]+)["\']?$', 'm')); return m ? m[1] : null }
    t.prefix    = g('LAUNCHDAEMON_PREFIX') || t.prefix
    t.system    = g('SYSTEM_NAME')        || t.system
    t.admin     = g('ADMIN_NAME')         || t.admin
    t.assistant = g('PERSONAL_AI_NAME')   || t.assistant
    t.overseer  = g('SECURITY_OVERSEER')  || t.overseer
    t.accent    = g('COLOR_ACCENT')       || t.accent
  } catch {}
  return t
}
const THEME = readTheme()
const PREFIX = THEME.prefix

function discoverModules() {
  const mods = []
  try {
    for (const e of fs.readdirSync(INSTALL_PATH, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = path.join(INSTALL_PATH, e.name)
      const env = path.join(dir, '.env')
      if (fs.existsSync(env)) mods.push({ name: e.name, dir, env })
    }
  } catch {}
  return mods
}

function parseEnv(p) {
  const out = {}
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return out
}

// OS-aware service inventory. macOS reads launchctl; Linux reads systemd.
// On Linux we list units matching `pbox-*` (the prefix used by
// pbox_create_service in lib/os-compat.sh) and key by the bare module name.
const IS_LINUX = process.platform === 'linux'

function _launchctlList() {
  let raw = ''
  try { raw = execFileSync('launchctl', ['list'], { encoding: 'utf8', timeout: 3000 }) }
  catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3 || !parts[2]) continue
    const [pid, exit, label] = parts
    if (!label.startsWith(PREFIX + '.')) continue
    out.push({
      label,
      module: label.slice(PREFIX.length + 1),
      pid: pid === '-' ? null : parseInt(pid, 10),
      last_exit: exit === '-' ? null : parseInt(exit, 10),
      running: pid !== '-' && pid !== '0',
    })
  }
  return out
}

function _systemctlList() {
  // list-units --type=service --all --no-legend --plain "pbox-*"
  let raw = ''
  try {
    raw = execFileSync('systemctl',
      ['list-units', '--type=service', '--all', '--no-legend', '--plain', 'pbox-*'],
      { encoding: 'utf8', timeout: 3000 })
  } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4) continue
    const [unit, , active, sub] = parts  // [UNIT, LOAD, ACTIVE, SUB, ...]
    if (!unit.startsWith('pbox-') || !unit.endsWith('.service')) continue
    const mod = unit.slice('pbox-'.length, -'.service'.length)
    // Best-effort PID via `systemctl show -p MainPID`. Cheap, single-fork.
    let pid = null
    try {
      const show = execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', unit],
        { encoding: 'utf8', timeout: 1500 }).trim()
      if (show && show !== '0') pid = parseInt(show, 10)
    } catch {}
    out.push({
      label: unit, module: mod, pid,
      last_exit: null,
      running: active === 'active' && sub === 'running',
    })
  }
  return out
}

const serviceList = IS_LINUX ? _systemctlList : _launchctlList

async function probeHttp(env) {
  const keys = ['PORT','DASHBOARD_PORT','DOCS_PORT','PERSONAL_AI_PORT',
                'TERMINAL_PORT','ADMIN_LITE_PORT','CONTENT_CLASSIFIER_PORT',
                'OFFLINE_KB_PORT','VECTOR_KB_PORT','MEDIA_PRODUCTION_PORT','SELF_IMPROVEMENT_PORT']
  let port = null
  for (const k of keys) if (env[k] && /^\d+$/.test(env[k])) { port = parseInt(env[k], 10); break }
  if (!port) return { port: null, http: null }
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, res => {
      resolve({ port, http: res.statusCode }); res.resume()
    })
    req.on('error', () => resolve({ port, http: null }))
    req.on('timeout', () => { req.destroy(); resolve({ port, http: null }) })
  })
}

// Update status written by scripts/pbox-update.sh --check-only (best-effort).
function readUpdateStatus() {
  for (const p of [path.join(INSTALL_PATH, '.update-status.json'),
                   path.join(INSTALL_PATH, 'data', '.update-status.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      return { current: j.current || j.installed || null, latest: j.latest || null,
               available: !!j.update_available || (j.latest && j.current && j.latest !== j.current) }
    } catch {}
  }
  return null
}

async function gatherStatus() {
  const services = serviceList()
  const modules = discoverModules()
  const installed = []
  for (const m of modules) {
    const env = parseEnv(m.env)
    // launchd uses `${PREFIX}.${name}` labels; systemd uses `pbox-${name}.service`.
    // We match by the bare module name on both via svc.module.
    const label = IS_LINUX ? `pbox-${m.name}.service` : `${PREFIX}.${m.name}`
    const svc = services.find(s => s.module === m.name) || null
    const probe = await probeHttp(env)
    installed.push({
      name: m.name, label,
      registered: !!svc, running: svc?.running ?? false,
      pid: svc?.pid ?? null, last_exit: svc?.last_exit ?? null,
      port: probe.port, http: probe.http,
    })
  }
  return {
    install_path: INSTALL_PATH, prefix: PREFIX, platform: process.platform,
    system: THEME.system, admin: THEME.admin, assistant: THEME.assistant, overseer: THEME.overseer,
    generated_at: new Date().toISOString(),
    installed,
    other_services: services.filter(s => !installed.some(m => m.name === s.module)),
    update: readUpdateStatus(),
  }
}

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

function stateOf(m) {
  if (!m.registered) return { s: 'not registered', cls: 'down' }
  if (!m.running) return { s: 'stopped', cls: 'down' }
  if (m.port && m.http != null && m.http >= 200 && m.http < 500) return { s: `:${m.port} OK`, cls: 'ok' }
  if (m.port && m.http == null) return { s: `:${m.port} bind?`, cls: 'warn' }
  return { s: 'running', cls: 'ok' }
}
// pretty label for a module dir name
const pretty = n => n.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const LOGO = `<svg class="logo" viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="26" rx="14" ry="10" fill="url(#lightG)" opacity=".8"/><path d="M14 30 L32 39 L32 52 L14 44 Z" fill="url(#bodyL)" stroke="#6a5acd" stroke-width="1"/><path d="M50 30 L32 39 L32 52 L50 44 Z" fill="url(#bodyR)" stroke="#6a5acd" stroke-width="1"/><path d="M14 30 L32 23 L50 30" fill="none" stroke="url(#seamG)" stroke-width="2.4"/><circle cx="32" cy="27" r="2.6" fill="#FFD700"/><path d="M16 19 L32 12 L48 19 L32 26 Z" fill="url(#lidG)" stroke="#c77dff" stroke-width="1"/></svg>`

function renderHtml(s) {
  const anyRunning = s.installed.some(m => m.running)
  const services = s.installed.map(m => {
    const st = stateOf(m)
    return `<div class="srv"><span class="p">${esc(pretty(m.name))}</span><span class="v ${st.cls}">${esc(st.s)}</span></div>`
  }).join('') || `<div class="srv"><span class="p">No services yet</span><span class="v warn">run the installer</span></div>`
  const mods = s.installed.map(m => `<span>${esc(m.name)}</span>`).join('') || `<span class="off">none installed</span>`
  const upd = s.update && s.update.available
    ? `<div class="card update"><h4>Update available</h4><div class="vs"><span class="o">installed ${esc(s.update.current||'?')}</span> &rarr; <span class="n">latest ${esc(s.update.latest||'?')}</span></div><p>Verified by SHA256, backed up automatically before applying, one-command rollback.</p><p style="font-size:11.5px;color:var(--muted);margin-bottom:6px">In Terminal, run:</p><code class="cmd">pbox-update --apply</code></div>`
    : `<div class="card update upToDate"><h4>Up to date</h4><div class="vs">${esc((s.update&&s.update.current)||'(release tag pending)')} is the latest release.</div></div>`

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="30">
<title>${esc(s.system)} · Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a14;--bg-deep:#07070f;--elev:#14141f;--surface:#1f1f2e;--rule:#2a2a40;--fg:#f0f0ff;--fg-soft:#c8c8e0;--muted:#8888aa;--grey:#9aa4b8;--brand:#7B68EE;--cyan:#00B4FF;--gold:#FFD700;--green:#7BFF7B;--accent:${esc(THEME.accent)};--grad:linear-gradient(135deg,var(--brand),var(--cyan));--grad-spec:linear-gradient(120deg,var(--brand),var(--cyan) 50%,var(--gold));--font:'Inter',-apple-system,sans-serif;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:var(--font);font-weight:300;min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(900px 600px at 82% -10%,rgba(123,104,238,.18),transparent 60%),radial-gradient(760px 520px at 8% 108%,rgba(0,180,255,.12),transparent 60%)}
.wrap{position:relative;z-index:2;max-width:1180px;margin:0 auto;padding:0 clamp(16px,3vw,28px)}
.ic{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
header{display:flex;align-items:center;gap:18px;padding:16px 0;border-bottom:1px solid var(--rule)}
.brand{display:flex;align-items:center;gap:11px}.logo{width:32px;height:32px;filter:drop-shadow(0 3px 9px rgba(123,104,238,.45))}
.bname{font-weight:700;font-size:16px;letter-spacing:1.2px}.bname .a{background:var(--grad-spec);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
nav{display:flex;gap:3px;margin-left:6px}nav a{color:var(--muted);text-decoration:none;font-size:13.5px;display:flex;align-items:center;gap:7px;padding:7px 11px;border-radius:8px;transition:.2s}nav a:hover{color:var(--cyan);background:var(--elev)}nav a.on{color:var(--fg);background:var(--surface)}nav a.on .ic{color:var(--accent)}
.bar-right{margin-left:auto;display:flex;align-items:center;gap:14px;font-family:var(--mono);font-size:11px;color:var(--muted)}
.pill{display:flex;align-items:center;gap:8px}.pill.on{color:var(--green)}.pill .d{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}.pill.off .d{background:var(--muted);box-shadow:none}
.lbl{display:flex;align-items:baseline;gap:14px;margin:26px 0 14px}.lbl h2{font-weight:600;font-size:14px;letter-spacing:2.5px;text-transform:uppercase;color:var(--fg-soft)}.lbl .ln{flex:1;height:1px;background:linear-gradient(90deg,var(--rule),transparent)}.lbl .ct{font-family:var(--mono);font-size:11px;color:var(--muted)}
.welcome{padding:30px 0 10px}.welcome h1{font-weight:600;font-size:clamp(26px,5vw,40px);line-height:1.07;letter-spacing:-.8px}.welcome h1 .g{background:var(--grad-spec);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.welcome p{color:var(--fg-soft);font-size:15px;margin-top:12px;max-width:54ch}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.feat{display:flex;gap:16px;align-items:center;padding:18px 20px;background:linear-gradient(120deg,var(--elev),var(--surface));border:1px solid var(--rule);border-radius:14px;position:relative;overflow:hidden}
.feat::after{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--grad-spec)}.feat.admin::after{background:linear-gradient(var(--accent),var(--muted))}
.orb{width:56px;height:56px;border-radius:50%;position:relative;flex:none;background:radial-gradient(circle,#0c0c18,#07070f);overflow:hidden;box-shadow:0 0 20px -3px var(--accent)}
.orb .core{position:absolute;inset:18%;border-radius:50%;background:radial-gradient(circle at 38% 34%,#fff,var(--accent) 46%,#15102e);animation:breathe 3.6s ease-in-out infinite}
.orb .ring{position:absolute;inset:6%;border-radius:50%;padding:2px;background:conic-gradient(from 0deg,transparent,var(--cyan),#fff,var(--accent),transparent);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 2px));mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 2px));animation:spin 6s linear infinite;opacity:.85}
@keyframes breathe{0%,100%{transform:scale(.9);opacity:.9}50%{transform:scale(1.05);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}
.sentinel{width:56px;height:56px;flex:none;clip-path:polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%);background:linear-gradient(160deg,#0c0c18,#07070f);box-shadow:0 0 20px -4px var(--accent);display:flex;align-items:center;justify-content:center;position:relative}
.sentinel .eye{width:40%;height:40%;border-radius:50%;border:2px solid var(--accent);box-shadow:0 0 10px -2px var(--accent);position:relative}.sentinel .eye::after{content:"";position:absolute;inset:30%;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent);animation:watch 4s ease-in-out infinite}
@keyframes watch{0%,100%{transform:translateX(-2px)}25%{transform:translateX(2px)}50%{transform:scaleY(.2)}55%{transform:scaleY(1)}}
.feat .role{font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}.feat h3{font-weight:600;font-size:19px;margin:2px 0 4px}.feat p{color:var(--muted);font-size:12.5px;line-height:1.45}
.cols{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px;margin-bottom:50px}
.card{background:var(--elev);border:1px solid var(--rule);border-radius:14px;padding:20px}
.card h4{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--rule)}
.srv{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:13px}.srv .p{color:var(--fg-soft)}.srv .v{font-family:var(--mono);font-size:11px}.srv .v.ok{color:var(--green)}.srv .v.warn{color:var(--gold)}.srv .v.down{color:var(--muted)}
.mods{display:flex;flex-wrap:wrap;gap:7px}.mods span{font-family:var(--mono);font-size:10.5px;padding:5px 9px;border:1px solid var(--rule);border-radius:6px;color:var(--fg-soft)}.mods span.off{color:var(--muted);border-style:dashed}
.update{border:1px solid rgba(255,215,0,.35);background:linear-gradient(150deg,rgba(255,215,0,.06),var(--elev))}.update h4{color:var(--gold);border-color:rgba(255,215,0,.25)}.update.upToDate{border-color:var(--rule)}.update.upToDate h4{color:var(--green)}
.update .vs{font-family:var(--mono);font-size:12.5px;margin:4px 0 12px}.update .vs .o{color:var(--muted)}.update .vs .n{color:var(--gold)}.update p{font-size:12.5px;color:var(--muted);margin-bottom:14px}
.btn-gold{display:inline-block;font-weight:600;font-size:13px;padding:9px 16px;border-radius:8px;background:var(--gold);color:#1a1400;text-decoration:none}
.cmd{display:block;font-family:var(--mono);font-size:12.5px;background:var(--bg-deep);border:1px solid var(--rule);border-radius:7px;padding:9px 11px;color:var(--gold)}
.meta{font-family:var(--mono);font-size:11px;color:var(--muted);padding-bottom:40px}.meta a{color:var(--cyan)}
@media(max-width:920px){nav{display:none}.duo{grid-template-columns:1fr}.cols{grid-template-columns:1fr}}
</style></head><body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<linearGradient id="bodyL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2f6b"/><stop offset="1" stop-color="#1a1338"/></linearGradient>
<linearGradient id="bodyR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2356"/><stop offset="1" stop-color="#140f2c"/></linearGradient>
<linearGradient id="lidG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c77dff"/><stop offset="55%" stop-color="#7B68EE"/><stop offset="100%" stop-color="#4b3fa0"/></linearGradient>
<linearGradient id="seamG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7B68EE"/><stop offset="50%" stop-color="#fff"/><stop offset="100%" stop-color="#c77dff"/></linearGradient>
<radialGradient id="lightG" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#fff"/><stop offset="40%" stop-color="#9d4edd"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<symbol id="i-home" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/></symbol>
<symbol id="i-agents" viewBox="0 0 24 24"><circle cx="8" cy="8" r="3.2"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15.5 20a5 5 0 0 1 6.5-2.5"/></symbol>
<symbol id="i-projects" viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="10" rx="1.2"/><rect x="17" y="4" width="4" height="13" rx="1.2"/></symbol>
<symbol id="i-blocks" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></symbol>
<symbol id="i-book" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z"/><line x1="9" y1="7" x2="15" y2="7"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></symbol>
</defs></svg>
<div class="wrap">
<header>
  <div class="brand">${LOGO}<span class="bname">${esc(s.system)}</span></div>
  <nav>
    <a href="/" class="on"><svg class="ic"><use href="#i-home"/></svg>Home</a>
    <a href="http://127.0.0.1:${esc(String((s.installed.find(m=>m.name==='personal-ai')||{}).port||8800))}/" target="_blank" rel="noopener"><svg class="ic"><use href="#i-agents"/></svg>Assistant</a>
    <a href="#modules"><svg class="ic"><use href="#i-blocks"/></svg>Modules</a>
    <a href="http://127.0.0.1:${esc(String((s.installed.find(m=>m.name==='docs-server')||{}).port||8485))}/" target="_blank" rel="noopener"><svg class="ic"><use href="#i-book"/></svg>Docs</a>
    <a href="http://127.0.0.1:${esc(String((s.installed.find(m=>m.name==='terminal')||{}).port||8484))}/" target="_blank" rel="noopener"><svg class="ic"><use href="#i-projects"/></svg>Terminal</a>
    <a href="/api/status" target="_blank" rel="noopener"><svg class="ic"><use href="#i-shield"/></svg>Status</a>
  </nav>
  <div class="bar-right"><span class="pill ${anyRunning?'on':'off'}"><span class="d"></span>${anyRunning?'ONLINE':'IDLE'}</span></div>
</header>

<section class="welcome">
  <h1>Welcome back. Everything runs <span class="g">on this machine.</span></h1>
  <p>No cloud middleman. Talk to your assistant, hand work to your agents, and watch over the whole system from here.</p>
</section>

<div class="lbl"><h2>Your team</h2><div class="ln"></div><span class="ct">always on</span></div>
<section class="duo">
  <div class="feat"><div class="orb"><div class="ring"></div><div class="core"></div></div><div><div class="role">Personal Assistant</div><h3>${esc(s.assistant)}</h3><p>Reads your mail, runs your calendar, builds documents, and coordinates your agents.</p></div></div>
  <div class="feat admin"><div class="sentinel"><div class="eye"></div></div><div><div class="role">Admin AI</div><h3>${esc(s.admin)}</h3><p>Watches every service, applies updates safely, and flags anything that needs you.</p></div></div>
</section>

<div class="lbl"><h2>System</h2><div class="ln"></div><span class="ct">watched by ${esc(s.admin)}</span></div>
<section class="cols">
  <div class="card"><h4>Service status</h4>${services}</div>
  <div class="card" id="modules"><h4>Modules</h4><div class="mods">${mods}</div></div>
  ${upd}
</section>

<div class="meta">Install: <code>${esc(s.install_path)}</code> &middot; ${esc(s.prefix)} &middot; refreshed ${esc(s.generated_at)} &middot; <a href="/api/status">JSON</a> &middot; <a href="/api/health">health</a></div>
</div></body></html>`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (url.pathname === '/api/health') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true,time:new Date().toISOString()})); return }
    if (url.pathname === '/api/status') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(s, null, 2)); return }
    if (url.pathname === '/api/update-status') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(readUpdateStatus() || { available: false })); return }
    if (url.pathname === '/') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderHtml(s)); return }
    res.writeHead(404, {'content-type':'text/plain'}); res.end('not found')
  } catch (e) { res.writeHead(500); res.end(`error: ${e.message}`) }
})

server.listen(PORT, BIND, () => {
  console.log(`[dashboard] listening on http://${BIND}:${PORT}`)
  console.log(`[dashboard] install path: ${INSTALL_PATH}`)
  console.log(`[dashboard] daemon prefix: ${PREFIX}`)
})
