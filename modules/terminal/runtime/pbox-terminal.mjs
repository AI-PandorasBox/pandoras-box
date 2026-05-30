#!/usr/bin/env node
// pbox-terminal.mjs -- Pandoras Box Admin CLI (browser): Shell (cmd runner, cwd-persistent) + Services + Logs + Jobs
//
// v0.4: tabbed admin console. Shell runs arbitrary commands (loopback-only by default).
// Browser UI on localhost:$TERMINAL_PORT (default 8484).
//
// Auth: PBKDF2-hashed passphrase set in TERMINAL_PASSPHRASE_HASH (.env).
//       Single-session cookie. Localhost-only by default.
// Security: Shell runs ARBITRARY commands as the service user (admin CLI, RCE by
//           design) -- gated by passphrase + loopback-only by default
//           (TERMINAL_ALLOW_REMOTE_SHELL=1 to expose). Restart uses execFile with
//           a label allowlist derived from systemctl/launchctl.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

// _CLAUDE_CLI_2026-05-30 -- the Shell tab is a live Claude Code session in a PTY,
// bridged to an xterm.js browser terminal over WebSocket (matches the internal
// admin terminal). node-pty + ws are optional: if absent, the Shell tab degrades
// to a clear message and Services/Logs/Jobs still work.
const _require = createRequire(import.meta.url)
const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url))
let pty = null, WebSocketServer = null
try { pty = _require('node-pty') } catch {}
try { ({ WebSocketServer } = _require('ws')) } catch {}
const CLAUDE_CLI_READY = !!(pty && WebSocketServer)

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.TERMINAL_PORT || '8484', 10)
const BIND = process.env.TERMINAL_BIND || '127.0.0.1'
const PASS_HASH = process.env.TERMINAL_PASSPHRASE_HASH || ''
const SESSION_TTL_MS = 1000 * 60 * 60  // 1 hour
// _ADMIN_CLI_2026-05-30 -- the Shell runs arbitrary commands. Loopback-only by
// default; refuse on a non-loopback bind unless the operator explicitly opts in.
const ALLOW_REMOTE_SHELL = process.env.TERMINAL_ALLOW_REMOTE_SHELL === '1'

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

// OS-aware service discovery. macOS reads launchctl; Linux reads systemd.
// On Linux the dropdown is keyed by `pbox-<name>.service`; on macOS by the
// LAUNCHDAEMON_PREFIX.<name> label. The "label" string returned here is what
// the UI shows AND what gets passed to /api/tail + /api/restart.
const IS_LINUX = process.platform === 'linux'

function allowedLabels() {
  if (IS_LINUX) {
    try {
      const raw = execFileSync('systemctl',
        ['list-units', '--type=service', '--all', '--no-legend', '--plain', 'pbox-*'],
        { encoding: 'utf8', timeout: 3000 })
      const labels = new Set()
      for (const line of raw.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 1 && parts[0].startsWith('pbox-') && parts[0].endsWith('.service')) {
          labels.add(parts[0])
        }
      }
      return labels
    } catch { return new Set() }
  }
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

// Resolve a label string back to its log file path. Module logs follow the
// pattern /tmp/<LOG_PREFIX>-<name>.log on both platforms.
function labelToLogPath(label) {
  let name
  if (IS_LINUX && label.startsWith('pbox-') && label.endsWith('.service')) {
    name = label.slice('pbox-'.length, -'.service'.length)
  } else if (label.startsWith(PREFIX + '.')) {
    name = label.slice(PREFIX.length + 1)
  } else {
    return null
  }
  return `/tmp/${LOG_PREFIX}-${name}.log`
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

// _ADMIN_CLI_2026-05-30 -- run a command, persisting the working directory so `cd`
// works across commands. Runs as the service user (with its sudo). Line-based.
function runCommand(cmd, cwd) {
  const base = (cwd && fs.existsSync(cwd)) ? cwd : (process.env.HOME || '/')
  const wrapped = `cd ${JSON.stringify(base)} 2>/dev/null; ${cmd}\n__RC=$?; printf '\\n__PBOX_CWD__%s\\n__PBOX_RC__%s\\n' "$(pwd)" "$__RC"`
  const r = spawnSync('bash', ['-lc', wrapped], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  let out = (r.stdout || '') + (r.stderr || '')
  let newCwd = base, rc = 0
  const mC = out.match(/\n__PBOX_CWD__(.*)\n/); if (mC) newCwd = mC[1]
  const mR = out.match(/__PBOX_RC__(-?\d+)\n?/); if (mR) rc = parseInt(mR[1], 10)
  out = out.replace(/\n__PBOX_CWD__[^\n]*\n__PBOX_RC__-?\d+\n?/, '')
  return { output: out, cwd: newCwd, rc }
}

// Job queue (if a conductor/agent installed one). Best-effort, read-only.
async function readJobs() {
  const cands = ['/var/ai-jobs/jobs.db', path.join(INSTALL_PATH, 'data', 'jobs.db'), path.join(INSTALL_PATH, 'store', 'jobs.db')]
  for (const p of cands) {
    try {
      if (!fs.existsSync(p)) continue
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(p, { readonly: true })
      const rows = db.prepare('SELECT id, company, task_type, status, created_at FROM jobs ORDER BY created_at DESC LIMIT 50').all()
      db.close()
      return { available: true, source: p, jobs: rows }
    } catch {}
  }
  return { available: false, jobs: [] }
}

function servicesStatus() {
  return [...allowedLabels()].sort().map(label => {
    let running = false
    try {
      if (IS_LINUX) running = (spawnSync('systemctl', ['is-active', label], { encoding: 'utf8', timeout: 2000 }).stdout || '').trim() === 'active'
      else running = true
    } catch {}
    return { label, running }
  })
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
  let sysName = 'Pandoras Box', adminName = 'Admin'
  try {
    const c = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = c.match(/^SYSTEM_NAME=["']?([^"'\n]+)/m); if (m) sysName = m[1]
    const a = c.match(/^ADMIN_NAME=["']?([^"'\n]+)/m); if (a) adminName = a[1]
  } catch {}
  const LOGO = `<svg class="logo" viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="26" rx="14" ry="10" fill="url(#lightG)" opacity=".8"/><path d="M14 30 L32 39 L32 52 L14 44 Z" fill="url(#bodyL)" stroke="#6a5acd" stroke-width="1"/><path d="M50 30 L32 39 L32 52 L50 44 Z" fill="url(#bodyR)" stroke="#6a5acd" stroke-width="1"/><path d="M14 30 L32 23 L50 30" fill="none" stroke="url(#seamG)" stroke-width="2.4"/><circle cx="32" cy="27" r="2.6" fill="#FFD700"/><path d="M16 19 L32 12 L48 19 L32 26 Z" fill="url(#lidG)" stroke="#c77dff" stroke-width="1"/></svg>`
  const shellInner = CLAUDE_CLI_READY
    ? '<div id="tc"></div>'
    : '<div class="cli-note">The Claude CLI needs <code>node-pty</code> + <code>ws</code>. Re-run the terminal installer to enable it:<br><br><code>sudo bash ' + INSTALL_PATH + '/modules/terminal/install.sh</code></div>'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(sysName)} · Admin</title>
<link rel="stylesheet" href="/vendor/xterm.css">
<style>
:root{--bg:#060912;--bg2:#0a0f1c;--rule:#1c2740;--gold:#d4af37;--cyan:#00d4ff;--green:#00ff88;--red:#ff5c5c;--fg:#e6ecf5;--muted:#6b7a93}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--fg);font-family:-apple-system,"Inter",sans-serif;height:100vh;overflow:hidden}
#shell{display:flex;flex-direction:column;height:100vh}
#topbar{flex-shrink:0;height:44px;background:rgba(2,6,16,.98);border-bottom:1px solid rgba(212,175,55,.22);display:flex;align-items:center;padding:0 16px;gap:11px}
#topbar .logo{width:26px;height:26px;filter:drop-shadow(0 2px 7px rgba(123,104,238,.5))}.tb-name{font-weight:700;font-size:13px;letter-spacing:1.5px}
.tb-pill{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);font-family:ui-monospace,monospace}
.tb-dot{width:7px;height:7px;border-radius:50%;background:var(--muted)}.tb-dot.on{background:var(--green);box-shadow:0 0 7px var(--green)}
#main{flex:1;display:flex;overflow:hidden}
#side{flex-shrink:0;width:296px;background:var(--bg2);border-right:1px solid var(--rule);display:flex;flex-direction:column;align-items:center;padding:24px 0}
.orb{width:84px;height:84px;border-radius:50%;position:relative;background:radial-gradient(circle at 50% 42%,rgba(0,212,255,.45),rgba(123,104,238,.18) 60%,transparent);display:flex;align-items:center;justify-content:center;margin-bottom:15px}
.orb .ring{position:absolute;inset:7px;border-radius:50%;border:1px solid rgba(0,212,255,.4)}
.orb .core{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff,#00d4ff 55%,#3a2f6b)}
.id-name{font-size:15px;letter-spacing:8px;color:rgba(212,175,55,.9);text-transform:uppercase;font-weight:600}
.id-role{font-size:8px;letter-spacing:3px;color:rgba(0,180,220,.5);text-transform:uppercase;margin-top:5px}
.divider{width:64%;height:1px;background:linear-gradient(90deg,transparent,var(--rule),transparent);margin:18px 0}
.status-title{font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted);align-self:flex-start;padding:0 26px;margin-bottom:8px}
#svc-status{width:100%;padding:0 26px}
.srow{display:flex;align-items:center;gap:9px;font-size:11px;padding:4px 0;color:#aab6c8}
.sdot{width:6px;height:6px;border-radius:50%;background:var(--muted);flex-shrink:0}.sdot.on{background:var(--green);box-shadow:0 0 5px rgba(0,255,136,.6)}.sdot.off{background:var(--red)}
.srow .nm{flex:1;font-family:ui-monospace,monospace}
.side-foot{margin-top:auto;font-size:10px;color:var(--muted);font-family:ui-monospace,monospace;padding:0 26px;align-self:flex-start}
#term-panel{flex:1;display:flex;flex-direction:column;background:#030912;overflow:hidden}
#tabs{flex-shrink:0;height:36px;background:rgba(2,6,14,.98);border-bottom:1px solid rgba(0,180,220,.12);display:flex;padding:0 8px}
#tabs button{font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:0 16px;height:100%;background:none;border:none;border-bottom:2px solid transparent;color:rgba(0,180,220,.45);cursor:pointer}
#tabs button:hover{color:rgba(0,180,220,.85)}#tabs button.on{color:var(--cyan);border-bottom-color:var(--cyan)}
.view{flex:1;overflow:auto;display:none}.view.on{display:flex;flex-direction:column}
#v-shell{padding:0}#tc{height:100%;width:100%;background:#050810}
.pad{padding:16px 18px}
table{width:100%;border-collapse:collapse;font-size:12.5px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid var(--rule)}th{color:var(--muted)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted)}.dot.on{background:var(--green);box-shadow:0 0 6px var(--green)}
button.act{background:var(--bg);border:1px solid var(--rule);color:var(--fg);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px}.act.danger{color:var(--red);border-color:var(--red)}
select{background:var(--bg);color:var(--fg);border:1px solid var(--rule);padding:7px;border-radius:6px}
#log-out{flex:1;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;background:#050810;border:1px solid var(--rule);border-radius:8px;padding:12px;margin:0 18px 16px}
.muted{color:var(--muted);font-size:12px}.cli-note{padding:22px;color:var(--muted);line-height:1.6}.cli-note code{background:#050810;border:1px solid var(--rule);padding:2px 6px;border-radius:4px;color:var(--fg)}
</style></head>
<body>
<svg width="0" height="0" style="position:absolute"><defs>
<linearGradient id="bodyL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2f6b"/><stop offset="1" stop-color="#1a1338"/></linearGradient>
<linearGradient id="bodyR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2356"/><stop offset="1" stop-color="#140f2c"/></linearGradient>
<linearGradient id="lidG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c77dff"/><stop offset="100%" stop-color="#4b3fa0"/></linearGradient>
<linearGradient id="seamG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7B68EE"/><stop offset="50%" stop-color="#fff"/><stop offset="100%" stop-color="#c77dff"/></linearGradient>
<radialGradient id="lightG" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#fff"/><stop offset="40%" stop-color="#9d4edd"/><stop offset="100%" stop-color="transparent"/></radialGradient>
</defs></svg>
<div id="shell">
  <div id="topbar">${LOGO}<span class="tb-name">${escapeHtml(sysName)}</span>
    <div class="tb-pill"><span class="tb-dot on" id="conn-dot"></span><span id="conn-label">Admin CLI</span></div>
  </div>
  <div id="main">
    <aside id="side">
      <div class="orb"><span class="ring"></span><span class="core"></span></div>
      <div class="id-name">${escapeHtml(adminName)}</div>
      <div class="id-role">System Administrator</div>
      <div class="divider"></div>
      <div class="status-title">Services</div>
      <div id="svc-status"><div class="muted" style="padding:0 26px">loading…</div></div>
      <div class="side-foot">loopback-only</div>
    </aside>
    <div id="term-panel">
      <div id="tabs">
        <button data-v="shell" class="on">Shell</button>
        <button data-v="services">Services</button>
        <button data-v="logs">Logs</button>
        <button data-v="jobs">Jobs</button>
      </div>
      <section class="view on" id="v-shell">${shellInner}</section>
      <section class="view" id="v-services"><div class="pad"><table id="svc-tbl"><thead><tr><th></th><th>Service</th><th></th></tr></thead><tbody></tbody></table></div></section>
      <section class="view" id="v-logs"><div class="pad"><select id="log-svc"><option value="">— pick a service —</option>${labelOptions}</select> <button class="act" id="log-tail">Tail</button></div><pre id="log-out">Pick a service and tail its log.</pre></section>
      <section class="view" id="v-jobs"><div class="pad" id="jobs-body"><span class="muted">Loading…</span></div></section>
    </div>
  </div>
</div>
<script src="/vendor/xterm.js"></script>
<script src="/vendor/addon-fit.js"></script>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
document.querySelectorAll('#tabs button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('#tabs button').forEach(function(x){x.classList.remove('on');});b.classList.add('on');
  document.querySelectorAll('.view').forEach(function(v){v.classList.remove('on');});document.getElementById('v-'+b.dataset.v).classList.add('on');
  if(b.dataset.v==='services')loadServices();if(b.dataset.v==='jobs')loadJobs();
  if(b.dataset.v==='shell'&&fit){setTimeout(function(){try{fit.fit();term.focus();}catch(e){}},40);}
};});
var term=null,fit=null,tws=null;
function initTerm(){ if(term||!window.Terminal||!document.getElementById('tc'))return;
  term=new Terminal({theme:{background:'#050810',foreground:'#c8c8c8',cursor:'#00d4ff',selectionBackground:'rgba(0,212,255,.22)',black:'#0a0d1a',brightBlack:'#555',red:'#ff4c4c',brightRed:'#ff7777',green:'#00ff88',brightGreen:'#55ffaa',yellow:'#d4af37',brightYellow:'#ffcc44',blue:'#00d4ff',brightBlue:'#44ddff',magenta:'#bf7fff',brightMagenta:'#cc99ff',cyan:'#00d4ff',brightCyan:'#44ddff',white:'#c8c8c8',brightWhite:'#fff'},fontFamily:'"JetBrains Mono","Fira Code","SF Mono",monospace',fontSize:14,lineHeight:1.4,cursorBlink:true,cursorStyle:'block',scrollback:5000});
  fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(document.getElementById('tc'));fit.fit();term.focus();
  var cd=document.getElementById('conn-dot'),cl=document.getElementById('conn-label');
  tws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  tws.onopen=function(){if(cd)cd.classList.add('on');if(cl)cl.textContent='Claude';tws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}));};
  tws.onmessage=function(ev){var m=JSON.parse(ev.data);if(m.type==='data')term.write(m.data);else if(m.type==='exit'){term.writeln('\\r\\n\\x1b[33m[Session ended — refresh to reconnect]\\x1b[0m');tws.close();}};
  tws.onclose=function(){if(cd)cd.classList.remove('on');if(cl)cl.textContent='disconnected';try{term.writeln('\\r\\n\\x1b[31m[Connection closed]\\x1b[0m');}catch(e){}};
  term.onData(function(d){if(tws&&tws.readyState===1)tws.send(JSON.stringify({type:'data',data:d}));});
  term.onResize(function(s){if(tws&&tws.readyState===1)tws.send(JSON.stringify({type:'resize',cols:s.cols,rows:s.rows}));});
  window.addEventListener('resize',function(){if(fit){try{fit.fit();}catch(e){}}});
}
initTerm();
function loadSidebarStatus(){fetch('/api/services').then(function(r){return r.json();}).then(function(rows){
  document.getElementById('svc-status').innerHTML=rows.map(function(s){var n=s.label.replace(/^pbox-/,'').replace(/\\.service$/,'');return '<div class="srow"><span class="sdot '+(s.running?'on':'off')+'"></span><span class="nm">'+esc(n)+'</span></div>';}).join('')||'<div class="muted" style="padding:0 26px">none</div>';
}).catch(function(){});}
loadSidebarStatus();setInterval(loadSidebarStatus,8000);
function loadServices(){fetch('/api/services').then(function(r){return r.json();}).then(function(rows){
  document.querySelector('#svc-tbl tbody').innerHTML=rows.map(function(s){return '<tr><td><span class="dot '+(s.running?'on':'')+'"></span></td><td>'+esc(s.label)+'</td><td><button class="act danger" data-r="'+esc(s.label)+'">Restart</button></td></tr>';}).join('')||'<tr><td colspan="3" class="muted">No services.</td></tr>';
  document.querySelectorAll('[data-r]').forEach(function(b){b.onclick=function(){if(!confirm('Restart '+b.dataset.r+'?'))return;fetch('/api/restart?label='+encodeURIComponent(b.dataset.r),{method:'POST'}).then(function(r){b.textContent=r.ok?'restarted':'failed';setTimeout(loadServices,1500);});};});});}
document.getElementById('log-tail').onclick=function(){var s=document.getElementById('log-svc').value;if(!s)return;document.getElementById('log-out').textContent='fetching…';fetch('/api/tail?label='+encodeURIComponent(s)).then(function(r){return r.text();}).then(function(t){var o=document.getElementById('log-out');o.textContent=t;o.scrollTop=o.scrollHeight;});};
function loadJobs(){fetch('/api/jobs').then(function(r){return r.json();}).then(function(d){var b=document.getElementById('jobs-body');
  if(!d.available){b.innerHTML='<span class="muted">No job queue on this install (the conductor/agent job system is not installed).</span>';return;}
  if(!d.jobs.length){b.innerHTML='<span class="muted">Job queue is empty.</span>';return;}
  b.innerHTML='<table><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Created</th></tr></thead><tbody>'+d.jobs.map(function(j){return '<tr><td>'+esc(j.id)+'</td><td>'+esc(j.task_type||'')+'</td><td>'+esc(j.status||'')+'</td><td class="muted">'+esc(j.created_at||'')+'</td></tr>';}).join('')+'</tbody></table>';});}
</script></body></html>`
}
const VENDOR_TYPES = { '.js': 'text/javascript', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    // _CLAUDE_CLI_2026-05-30 -- bundled xterm.js assets (served locally; offline-first)
    if (url.pathname.startsWith('/vendor/')) {
      const name = path.basename(url.pathname)
      const fp = path.join(RUNTIME_DIR, 'vendor', name)
      if (fs.existsSync(fp) && fp.startsWith(path.join(RUNTIME_DIR, 'vendor'))) {
        res.writeHead(200, { 'content-type': VENDOR_TYPES[path.extname(name)] || 'application/octet-stream', 'cache-control': 'public, max-age=86400' })
        return res.end(fs.readFileSync(fp))
      }
      res.writeHead(404); return res.end('not found')
    }
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
      const file = labelToLogPath(label)
      if (!file) { res.writeHead(400); res.end('bad label'); return }
      res.writeHead(200, {'content-type':'text/plain; charset=utf-8'})
      res.end(tailLog(file))
      return
    }
    if (url.pathname === '/api/restart' && req.method === 'POST') {
      const label = url.searchParams.get('label') || ''
      if (!allowedLabels().has(label)) { res.writeHead(404); res.end('unknown label'); return }
      try {
        if (IS_LINUX) {
          // systemctl restart needs root; the terminal service does not run as
          // root. Use sudo with a NOPASSWD rule installed by setup-terminal.
          // (Falls back to a plain systemctl call which will fail informatively
          // if the rule is missing.)
          execFileSync('sudo', ['-n', 'systemctl', 'restart', label], { timeout: 8000 })
        } else {
          execFileSync('launchctl', ['stop', label], { timeout: 5000 })
          execFileSync('launchctl', ['start', label], { timeout: 5000 })
        }
        res.writeHead(200); res.end('ok')
      } catch (e) { res.writeHead(500); res.end(`restart failed: ${e.message}`) }
      return
    }
    // _ADMIN_CLI_2026-05-30 -- console endpoints
    if (url.pathname === '/api/services') {
      res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(servicesStatus())); return
    }
    if (url.pathname === '/api/jobs') {
      readJobs().then(j => { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(j)) })
      return
    }
    if (url.pathname === '/api/exec' && req.method === 'POST') {
      if (BIND !== '127.0.0.1' && !ALLOW_REMOTE_SHELL) {
        res.writeHead(403, {'content-type':'application/json'})
        res.end(JSON.stringify({ output: 'Shell is disabled on a non-loopback bind (loopback-only by default). Set TERMINAL_ALLOW_REMOTE_SHELL=1 to override.', cwd: '', rc: 1 }))
        return
      }
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        let cmd = '', cwd = ''
        try { const j = JSON.parse(body); cmd = String(j.cmd || ''); cwd = String(j.cwd || '') } catch {}
        if (!cmd.trim()) { res.writeHead(400, {'content-type':'application/json'}); res.end(JSON.stringify({ error: 'cmd required' })); return }
        let r
        try { r = runCommand(cmd, cwd) } catch (e) { r = { output: 'exec error: ' + e.message, cwd, rc: 1 } }
        res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(r))
      })
      return
    }
    res.writeHead(404); res.end('not found')
  } catch (e) { res.writeHead(500); res.end(`error: ${e.message}`) }
})

// _CLAUDE_CLI_2026-05-30 -- WebSocket bridge: each /ws connection spawns a PTY
// running an interactive `claude` session (matches the internal admin terminal),
// streamed to the browser's xterm.js. Auth = the same passphrase session cookie.
if (CLAUDE_CLI_READY) {
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws, req) => {
    if (!validSession(req)) { try { ws.send(JSON.stringify({ type: 'data', data: '\r\nUnauthorized\r\n' })) } catch {} ; ws.close(1008, 'Unauthorized'); return }
    if (BIND !== '127.0.0.1' && !ALLOW_REMOTE_SHELL) {
      try { ws.send(JSON.stringify({ type: 'data', data: '\r\n\x1b[33mClaude CLI is disabled on a non-loopback bind (loopback-only by default). Set TERMINAL_ALLOW_REMOTE_SHELL=1 to expose.\x1b[0m\r\n' })) } catch {}
      ws.close(); return
    }
    let proc
    try {
      proc = pty.spawn('bash', ['-lc', 'clear; unset CLAUDECODE; exec claude'], {
        name: 'xterm-256color', cols: 120, rows: 34,
        cwd: process.env.HOME || INSTALL_PATH,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      })
    } catch (e) {
      try { ws.send(JSON.stringify({ type: 'data', data: '\r\nCould not start Claude: ' + e.message + '\r\n' })) } catch {}
      ws.close(); return
    }
    proc.onData(d => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data: d })) })
    proc.onExit(() => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit' })) } catch {} })
    ws.on('message', raw => {
      try { const m = JSON.parse(raw); if (m.type === 'data') proc.write(m.data); else if (m.type === 'resize' && m.cols && m.rows) proc.resize(m.cols, m.rows) } catch {}
    })
    ws.on('close', () => { try { proc.kill() } catch {} })
  })
}

server.listen(PORT, BIND, () => {
  console.log(`[terminal] Claude CLI: ${CLAUDE_CLI_READY ? 'ready (node-pty + ws)' : 'DISABLED -- node-pty/ws not installed; Shell tab will show a notice'}`)
  console.log(`[terminal] listening on http://${BIND}:${PORT}`)
  console.log(`[terminal] install path: ${INSTALL_PATH}`)
  if (!PASS_HASH) console.log(`[terminal] WARNING: TERMINAL_PASSPHRASE_HASH not set; login will always fail`)
})
