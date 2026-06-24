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

// Modules that ship as upstream third-party services (not pbox-prefixed).
// Map module dir name -> actual systemd unit. Lets the dashboard recognise them.
const LINUX_UPSTREAM_UNITS = {
  ollama: 'ollama.service',
}

function _systemctlList() {
  // list-units pbox-* covers our own units; merge in any mapped upstream units.
  const patterns = ['pbox-*', ...Object.values(LINUX_UPSTREAM_UNITS)]
  let raw = ''
  try {
    raw = execFileSync('systemctl',
      ['list-units', '--type=service', '--all', '--no-legend', '--plain', ...patterns],
      { encoding: 'utf8', timeout: 3000 })
  } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4) continue
    const [unit, , active, sub] = parts  // [UNIT, LOAD, ACTIVE, SUB, ...]
    if (!unit.endsWith('.service')) continue
    let mod
    if (unit.startsWith('pbox-')) {
      mod = unit.slice('pbox-'.length, -'.service'.length)
    } else {
      // Reverse-lookup upstream unit -> module dir name.
      const entry = Object.entries(LINUX_UPSTREAM_UNITS).find(([, u]) => u === unit)
      if (!entry) continue
      mod = entry[0]
    }
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

// --- skills library -------------------------------------------------------
// Reads installed skill primitives from $INSTALL_PATH/shared/skills/library/*/SKILL.md
// (YAML-ish frontmatter: name, description, version). No placeholder -- real files only.
function loadSkills() {
  const root = path.join(INSTALL_PATH, 'shared', 'skills', 'library')
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { return out }
  for (const d of dirs) {
    let md = path.join(root, d.name, 'SKILL.md')
    // Governed/fleet skills keep SKILL.md under the latest version dir (v1/, v2/...),
    // with only skill-card.md at top level -- fall back to vN/SKILL.md so the
    // description still renders for packaged skills. _SKILLS_VERSIONED_READ_V1
    if (!fs.existsSync(md)) {
      try {
        const vs = fs.readdirSync(path.join(root, d.name), { withFileTypes: true })
          .filter(e => e.isDirectory() && /^v\d+$/.test(e.name)).map(e => e.name)
          .sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1)))
        for (const v of vs) { const c = path.join(root, d.name, v, 'SKILL.md'); if (fs.existsSync(c)) { md = c; break } }
      } catch {}
    }
    let name = d.name, description = '', version = ''
    try {
      const raw = fs.readFileSync(md, 'utf8')
      const fm = raw.match(/^---\n([\s\S]*?)\n---/)
      const body = fm ? fm[1] : raw
      const nm = body.match(/^name:\s*(.+)$/m); if (nm) name = nm[1].trim()
      const vm = body.match(/^version:\s*(.+)$/m); if (vm) version = vm[1].trim()
      // description may be a YAML folded block (description: > then indented lines)
      const dm = body.match(/^description:\s*>?\s*\n((?:\s+.+\n?)+)/m)
      if (dm) description = dm[1].replace(/\s+/g, ' ').trim()
      else { const dl = body.match(/^description:\s*(.+)$/m); if (dl) description = dl[1].trim() }
    } catch {}
    out.push({ id: d.name, name, description, version })
  }
  return out
}

// --- projects -------------------------------------------------------------
// Reads tracked projects from $INSTALL_PATH/projects/*/project.json. Real data
// only; the Projects page filters client-side over whatever exists.
function loadProjects() {
  const root = path.join(INSTALL_PATH, 'projects')
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { return out }
  for (const d of dirs) {
    const pj = path.join(root, d.name, 'project.json')
    if (!fs.existsSync(pj)) continue
    try {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
      const tasks = Array.isArray(j.tasks) ? j.tasks : []
      const done = tasks.filter(t => t.status === 'complete' || t.status === 'done' || t.status === 'deployed').length
      out.push({
        id: j.id || d.name,
        title: j.title || j.name || d.name,
        description: (j.description || '').replace(/\s+/g, ' ').slice(0, 180),
        status: j.status || 'pending',
        tasks_done: done, tasks_total: tasks.length,
        updated: j.updated_at || j.created_at || '',
      })
    } catch {}
  }
  return out
}

// --- module registry (subsystems + capabilities source of truth) ----------
function loadRegistry() {
  for (const p of [path.join(INSTALL_PATH, 'modules', 'registry.json'),
                   path.join(INSTALL_PATH, 'registry.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      return Array.isArray(j) ? j : (j.modules || [])
    } catch {}
  }
  return []
}

// --- admin memory surface -------------------------------------------------
// Reads the assistant's local memory store (facts/drops/tasks/contacts) so the
// admin can review what the system knows. Read-only; counts + recent rows.
async function loadAdminMemory() {
  const dbPath = path.join(INSTALL_PATH, 'personal-ai', 'store', 'memory.db')
  const res = { available: false, path: dbPath, tables: {}, facts: [], drops: [], tasks: [] }
  if (!fs.existsSync(dbPath)) return res
  let DatabaseSync
  try { ({ DatabaseSync } = await import('node:sqlite')) } catch { return res }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    res.available = true
    const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    for (const t of tbls) {
      try { res.tables[t] = db.prepare(`SELECT count(*) c FROM "${t}"`).get().c } catch {}
    }
    const safe = (sql) => { try { return db.prepare(sql).all() } catch { return [] } }
    res.facts = safe('SELECT * FROM important_facts ORDER BY rowid DESC LIMIT 50')
    res.drops = safe('SELECT * FROM drops ORDER BY rowid DESC LIMIT 50')
    res.tasks = safe('SELECT * FROM tasks ORDER BY rowid DESC LIMIT 50')
    db.close()
  } catch {}
  return res
}

// --- activation matrix (per-agent capability toggles) --------------------- // _PUBLIC_ACTIVATION_V1
// The Activation page is the public port of the live per-agent card system: a
// per-agent card whose tools/skills/modules tiers can be TOGGLED, backed by a
// catalogue data layer, persisted to agent-activation.json, and read by the
// personal-ai runtime to gate which tools the assistant is offered.
//
// Single-user model: toggles write the activation file DIRECTLY (no Zeus deploy
// queue, no R8 signing -- that machinery is master-only). Localhost-bound like the
// rest of the dashboard. The default agent id is "muse" (the assistant).
const ACTIVATION_PATH = path.join(INSTALL_PATH, 'shared', 'agent-activation.json')
const TOOL_CATALOGUE_PATH = path.join(INSTALL_PATH, 'personal-ai', 'runtime', 'tool-catalogue.json')
const VALID_TIERS = new Set(['tools', 'skills', 'modules'])
const TIER_FIELD = { tools: 'tools_active', skills: 'skills_active', modules: 'modules_active' }

function readActivation() {
  try { return JSON.parse(fs.readFileSync(ACTIVATION_PATH, 'utf8')) } catch { return {} }
}
function writeActivation(obj) {
  obj._updated_at = new Date().toISOString()
  const tmp = ACTIVATION_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
  fs.renameSync(tmp, ACTIVATION_PATH)   // atomic replace
}
// Catalogue data layer: the full tool surface (from the personal-ai catalogue),
// installed skills, and installed modules. Mirrors listCatalogue() in the live
// card routes, sourced from the public artefacts that actually ship.
function loadToolCatalogue() {
  try { const j = JSON.parse(fs.readFileSync(TOOL_CATALOGUE_PATH, 'utf8')); return Array.isArray(j.tools) ? j.tools : [] }
  catch { return [] }
}
function activationData(agentId) {
  const act = readActivation()
  const agent = act[agentId] || {}
  const tools = loadToolCatalogue().map(t => t.name)
  const skills = loadSkills().map(k => k.id)
  const modules = loadRegistry().map(m => m.name)
  const setOf = (field) => new Set(Array.isArray(agent[field]) ? agent[field] : [])
  return {
    agent_id: agentId,
    display_name: agent.display_name || THEME.assistant || 'Assistant',
    principal_type: agent.principal_type || 'personal-assistant',
    catalogue: { tools, skills, modules },
    active: {
      tools: Array.from(setOf('tools_active')),
      skills: Array.from(setOf('skills_active')),
      modules: Array.from(setOf('modules_active')),
    },
  }
}
function toggleActivation(agentId, tier, itemName, action) {
  if (!VALID_TIERS.has(tier)) return { error: 'invalid tier' }
  if (!['activate', 'deactivate'].includes(action)) return { error: 'invalid action' }
  if (!itemName || !/^[a-zA-Z0-9_.-]+$/.test(itemName)) return { error: 'invalid item' }
  // Validate the item exists in the catalogue tier (no arbitrary writes).
  const cat = activationData(agentId).catalogue[tier] || []
  if (!cat.includes(itemName)) return { error: `unknown ${tier} item: ${itemName}` }
  const act = readActivation()
  if (!act[agentId]) act[agentId] = { display_name: THEME.assistant || 'Assistant', principal_type: 'personal-assistant' }
  const field = TIER_FIELD[tier]
  const set = new Set(Array.isArray(act[agentId][field]) ? act[agentId][field] : [])
  if (action === 'activate') set.add(itemName); else set.delete(itemName)
  act[agentId][field] = Array.from(set).sort()
  writeActivation(act)
  return { ok: true, agent_id: agentId, tier, item: itemName, action, active_count: set.size }
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

// Shared CSS for every page. Centralised so /modules, /status, /projects
// share the design tokens with /. _DASHBOARD_UI_V2_SHARED.
const SHARED_CSS = () => `<style>
:root{--bg:#060912;--bg-deep:#040810;--elev:#0d1322;--surface:#141b2e;--rule:#1c2740;--fg:#e6ecf5;--fg-soft:#c8c8e0;--muted:#6b7a93;--grey:#9aa4b8;--brand:#7B68EE;--cyan:#00d4ff;--gold:#d4af37;--green:#00ff88;--red:#ff5c5c;--accent:${esc(THEME.accent)};--grad:linear-gradient(135deg,var(--brand),var(--cyan));--grad-spec:linear-gradient(120deg,var(--brand),var(--cyan) 50%,var(--gold));--font:'Inter',-apple-system,sans-serif;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:var(--font);font-weight:300;min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(900px 600px at 82% -10%,rgba(123,104,238,.18),transparent 60%),radial-gradient(760px 520px at 8% 108%,rgba(0,180,255,.12),transparent 60%)}
.wrap{position:relative;z-index:2;max-width:1180px;margin:0 auto;padding:0 clamp(16px,3vw,28px)}
.ic{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
header{display:flex;align-items:center;gap:18px;padding:16px 0;border-bottom:1px solid var(--rule)}
.brand{display:flex;align-items:center;gap:11px}.logo{width:32px;height:32px;filter:drop-shadow(0 3px 9px rgba(123,104,238,.45))}
.bname{font-weight:700;font-size:16px;letter-spacing:1.2px}
nav{display:flex;gap:3px;margin-left:6px}nav a{color:var(--muted);text-decoration:none;font-size:13.5px;display:flex;align-items:center;gap:7px;padding:7px 11px;border-radius:8px;transition:.2s}nav a:hover{color:var(--cyan);background:var(--elev)}nav a.on{color:var(--fg);background:var(--surface)}nav a.on .ic{color:var(--accent)}
.bar-right{margin-left:auto;display:flex;align-items:center;gap:14px;font-family:var(--mono);font-size:11px;color:var(--muted)}
.pill{display:flex;align-items:center;gap:8px}.pill.on{color:var(--green)}.pill .d{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}.pill.off .d{background:var(--muted);box-shadow:none}
.lbl{display:flex;align-items:baseline;gap:14px;margin:26px 0 14px}.lbl h2{font-weight:600;font-size:14px;letter-spacing:2.5px;text-transform:uppercase;color:var(--fg-soft)}.lbl .ln{flex:1;height:1px;background:linear-gradient(90deg,var(--rule),transparent)}.lbl .ct{font-family:var(--mono);font-size:11px;color:var(--muted)}
.welcome{padding:30px 0 10px}.welcome h1{font-weight:600;font-size:clamp(26px,5vw,40px);line-height:1.07;letter-spacing:-.8px}.welcome h1 .g{background:var(--grad-spec);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.welcome p{color:var(--fg-soft);font-size:15px;margin-top:12px;max-width:54ch}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.launchgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.launch{display:block;padding:16px 18px;border-radius:12px;background:var(--elev);border:1px solid var(--rule);text-decoration:none;color:var(--fg);transition:.15s}
.launch:hover{border-color:var(--accent);background:var(--surface);transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.3)}
.lt-name{font-weight:600;font-size:15px;margin-bottom:5px;display:flex;align-items:baseline;gap:7px}
.lt-port{font-family:var(--mono);font-size:11px;color:var(--muted);font-weight:400}
.lt-desc{font-size:12.5px;color:var(--muted);line-height:1.4}
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
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:50px}
.card{background:var(--elev);border:1px solid var(--rule);border-radius:14px;padding:20px}
.card h3{font-weight:600;font-size:15px;margin-bottom:6px}
.card h4{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--rule)}
.card p{color:var(--fg-soft);font-size:13.5px;line-height:1.5;margin-bottom:8px}
.card .row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12.5px;border-bottom:1px solid rgba(255,255,255,0.04)}.card .row:last-child{border-bottom:0}
.card .row .k{color:var(--muted);font-family:var(--mono);font-size:11px}.card .row .v{font-family:var(--mono);font-size:11.5px;color:var(--fg-soft)}
.card .row .v.ok{color:var(--green)}.card .row .v.warn{color:var(--gold)}.card .row .v.down{color:var(--muted)}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:40px}
.srv{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:13px}.srv .p{color:var(--fg-soft)}.srv .v{font-family:var(--mono);font-size:11px}.srv .v.ok{color:var(--green)}.srv .v.warn{color:var(--gold)}.srv .v.down{color:var(--muted)}
.mods{display:flex;flex-wrap:wrap;gap:7px}.mods span{font-family:var(--mono);font-size:10.5px;padding:5px 9px;border:1px solid var(--rule);border-radius:6px;color:var(--fg-soft)}.mods span.off{color:var(--muted);border-style:dashed}
.update{border:1px solid rgba(255,215,0,.35);background:linear-gradient(150deg,rgba(255,215,0,.06),var(--elev))}.update h4{color:var(--gold);border-color:rgba(255,215,0,.25)}.update.upToDate{border-color:var(--rule)}.update.upToDate h4{color:var(--green)}
.update .vs{font-family:var(--mono);font-size:12.5px;margin:4px 0 12px}.update .vs .o{color:var(--muted)}.update .vs .n{color:var(--gold)}.update p{font-size:12.5px;color:var(--muted);margin-bottom:14px}
.btn-gold{display:inline-block;font-weight:600;font-size:13px;padding:9px 16px;border-radius:8px;background:var(--gold);color:#1a1400;text-decoration:none}
.btn{display:inline-block;font-size:12px;padding:6px 12px;border-radius:6px;background:var(--surface);color:var(--fg-soft);border:1px solid var(--rule);cursor:pointer;font-family:var(--mono);text-decoration:none}.btn:hover{background:var(--elev);color:var(--cyan)}
.btn.danger{color:var(--red);border-color:rgba(255,107,107,.3)}.btn.danger:hover{background:rgba(255,107,107,.08)}
.cmd{display:block;font-family:var(--mono);font-size:12.5px;background:var(--bg-deep);border:1px solid var(--rule);border-radius:7px;padding:9px 11px;color:var(--gold)}
.meta{font-family:var(--mono);font-size:11px;color:var(--muted);padding-bottom:40px}.meta a{color:var(--cyan)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}.dot.on{background:var(--green);box-shadow:0 0 6px var(--green)}.dot.off{background:var(--muted)}.dot.warn{background:var(--gold)}
.placeholder{padding:60px 40px;text-align:center;color:var(--muted);font-size:14px}
@media(max-width:920px){nav{display:none}.duo{grid-template-columns:1fr}.cols{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}}
</style>`

// Shared <head> + <header> + <nav>. currentPath highlights the active nav.
function pageShell(s, { title, currentPath = '/' }, bodyHtml) {
  const anyRunning = s.installed.some(m => m.running)
  const paPort = (s.installed.find(m => m.name === 'personal-ai') || {}).port || 8800
  const docsPort = (s.installed.find(m => m.name === 'docs-server') || {}).port || 8485
  const termPort = (s.installed.find(m => m.name === 'terminal') || {}).port || 8484
  const on = p => currentPath === p ? ' class="on"' : ''
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.system)} · ${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
${SHARED_CSS()}
</head><body>
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
<symbol id="i-term" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></symbol>
</defs></svg>
<div class="wrap">
<header>
  <div class="brand">${LOGO}<span class="bname">${esc(s.system)}</span></div>
  <nav>
    <a href="/"${on('/')}><svg class="ic"><use href="#i-home"/></svg>Home</a>
    <a href="#" data-port="${esc(String(paPort))}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-agents"/></svg>Assistant</a>
    <a href="/modules"${on('/modules')}><svg class="ic"><use href="#i-blocks"/></svg>Modules</a>
    <a href="/projects"${on('/projects')}><svg class="ic"><use href="#i-projects"/></svg>Projects</a>
    <a href="/skills"${on('/skills')}><svg class="ic"><use href="#i-projects"/></svg>Skills</a>
    <a href="/subsystems"${on('/subsystems')}><svg class="ic"><use href="#i-shield"/></svg>Subsystems</a>
    <a href="/activation"${on('/activation')}><svg class="ic"><use href="#i-blocks"/></svg>Activation</a>
    <a href="#" data-port="${esc(String(docsPort))}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-book"/></svg>Guide</a>
    <a href="/memory"${on('/memory')}><svg class="ic"><use href="#i-agents"/></svg>Memory</a>
    <a href="#" data-port="${esc(String(termPort))}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-term"/></svg>Terminal</a>
    <a href="/status"${on('/status')}><svg class="ic"><use href="#i-blocks"/></svg>Status</a>
  </nav>
  <div class="bar-right"><span class="pill ${anyRunning?'on':'off'}"><span class="d"></span>${anyRunning?'ONLINE':'IDLE'}</span></div>
</header>
${bodyHtml}
<div class="meta">Install: <code>${esc(s.install_path)}</code> &middot; ${esc(s.prefix)} &middot; refreshed ${esc(s.generated_at)} &middot; <a href="/api/status">JSON</a> &middot; <a href="/api/health">health</a></div>
</div>
<script>
// _HOST_AWARE_LINKS_2026-05-30 -- cross-surface links (nav, tiles, module Open) carry
// data-port only; resolve to the host the user is actually viewing from, so they work
// over loopback AND Tailscale (never hardcode 127.0.0.1).
document.querySelectorAll('a[data-port]').forEach(function(a){a.href=location.protocol+'//'+location.hostname+':'+a.dataset.port+'/';});
</script>
</body></html>`
}

function renderHtml(s) {
  const services = s.installed.map(m => {
    const st = stateOf(m)
    return `<div class="srv"><span class="p">${esc(pretty(m.name))}</span><span class="v ${st.cls}">${esc(st.s)}</span></div>`
  }).join('') || `<div class="srv"><span class="p">No services yet</span><span class="v warn">run the installer</span></div>`
  const mods = s.installed.map(m => `<span>${esc(m.name)}</span>`).join('') || `<span class="off">none installed</span>`
  const upd = s.update && s.update.available
    ? `<div class="card update"><h4>Update available</h4><div class="vs"><span class="o">installed ${esc(s.update.current||'?')}</span> &rarr; <span class="n">latest ${esc(s.update.latest||'?')}</span></div><p>Verified by SHA256, backed up automatically before applying, one-command rollback.</p><p style="font-size:11.5px;color:var(--muted);margin-bottom:6px">In Terminal, run:</p><code class="cmd">pbox-update --apply</code></div>`
    : `<div class="card update upToDate"><h4>Up to date</h4><div class="vs">${esc((s.update&&s.update.current)||'(release tag pending)')} is the latest release.</div></div>`

  // _LAUNCH_TILES_2026-05-30 -- clickable tiles to open each running web surface.
  // Host is resolved client-side so the links work over loopback AND Tailscale.
  const LAUNCH = {
    'personal-ai': { name: s.assistant || 'Assistant', desc: 'Chat, tasks, create, research, files' },
    'docs-server': { name: 'Docs', desc: 'Manuals and setup guides' },
    'terminal':    { name: 'Terminal', desc: 'Browser-based shell' },
    'admin-lite':  { name: 'Admin', desc: 'Mobile admin panel' },
  }
  const launchTiles = s.installed
    .filter(m => LAUNCH[m.name] && m.running && m.port)
    .map(m => `<a class="launch" data-port="${m.port}" target="_blank" rel="noopener"><div class="lt-name">${esc(LAUNCH[m.name].name)} <span class="lt-port">:${m.port}</span></div><div class="lt-desc">${esc(LAUNCH[m.name].desc)}</div></a>`).join('')
  const launchSection = launchTiles
    ? `<div class="lbl"><h2>Quick launch</h2><div class="ln"></div><span class="ct">open a surface</span></div>
<section class="launchgrid">${launchTiles}</section>
<script>document.querySelectorAll('.launch[data-port]').forEach(function(a){a.href=location.protocol+'//'+location.hostname+':'+a.dataset.port+'/';});</script>`
    : ''

  const body = `
<section class="welcome">
  <h1>Welcome back. Everything runs <span class="g">on this machine.</span></h1>
  <p>No cloud middleman. Talk to your assistant, hand work to your agents, and watch over the whole system from here.</p>
</section>
${launchSection}

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
</section>`
  return pageShell(s, { title: 'Dashboard', currentPath: '/' }, body)
}

// /modules -- per-module card grid with port, status, log path, restart link.
function renderModulesPage(s) {
  if (!s.installed.length) {
    return pageShell(s, { title: 'Modules', currentPath: '/modules' },
      `<div class="welcome"><h1>Modules</h1><p>No modules installed yet. Run the installer to add capabilities.</p></div>`)
  }
  const cards = s.installed.map(m => {
    const st = stateOf(m)
    const portLine = m.port
      ? `<div class="row"><span class="k">Port</span><span class="v">${esc(String(m.port))}</span></div>`
      : ''
    const httpLine = m.http != null
      ? `<div class="row"><span class="k">HTTP</span><span class="v ${m.http >= 200 && m.http < 500 ? 'ok' : 'warn'}">${esc(String(m.http))}</span></div>`
      : ''
    const pidLine = m.pid
      ? `<div class="row"><span class="k">PID</span><span class="v">${esc(String(m.pid))}</span></div>`
      : ''
    const link = m.port
      ? `<a class="btn" href="#" data-port="${esc(String(m.port))}" target="_blank" rel="noopener">Open</a>`
      : ''
    return `<div class="card">
  <h3><span class="dot ${st.cls === 'ok' ? 'on' : (st.cls === 'warn' ? 'warn' : 'off')}"></span>${esc(pretty(m.name))}</h3>
  <p style="color:var(--muted);font-size:12px;font-family:var(--mono);margin-bottom:14px">${esc(m.label)}</p>
  <div class="row"><span class="k">State</span><span class="v ${st.cls}">${esc(st.s)}</span></div>
  ${portLine}
  ${httpLine}
  ${pidLine}
  <div class="row"><span class="k">Log</span><span class="v">/tmp/pandoras-box-${esc(m.name)}.log</span></div>
  <div style="margin-top:14px;display:flex;gap:8px">${link}</div>
</div>`
  }).join('\n')
  const body = `
<section class="welcome">
  <h1>Modules</h1>
  <p>Every service installed on this box. Click Open to visit, or use the Terminal page to tail logs / restart.</p>
</section>
<div class="lbl"><h2>${s.installed.length} installed</h2><div class="ln"></div><span class="ct">refreshed live</span></div>
<section class="card-grid">${cards}</section>`
  return pageShell(s, { title: 'Modules', currentPath: '/modules' }, body)
}

// /status -- same data as /api/status but rendered with the dashboard's design.
function renderStatusPage(s) {
  const rows = s.installed.map(m => {
    const st = stateOf(m)
    return `<div class="card">
  <h3><span class="dot ${st.cls === 'ok' ? 'on' : (st.cls === 'warn' ? 'warn' : 'off')}"></span>${esc(pretty(m.name))}</h3>
  <div class="row"><span class="k">Unit</span><span class="v">${esc(m.label)}</span></div>
  <div class="row"><span class="k">Registered</span><span class="v ${m.registered?'ok':'down'}">${m.registered?'yes':'no'}</span></div>
  <div class="row"><span class="k">Running</span><span class="v ${m.running?'ok':'down'}">${m.running?'yes':'no'}</span></div>
  <div class="row"><span class="k">Port</span><span class="v">${esc(m.port?String(m.port):'--')}</span></div>
  <div class="row"><span class="k">HTTP</span><span class="v ${m.http!=null && m.http<500?'ok':'down'}">${esc(m.http!=null?String(m.http):'--')}</span></div>
  <div class="row"><span class="k">PID</span><span class="v">${esc(m.pid?String(m.pid):'--')}</span></div>
</div>`
  }).join('\n')
  const body = `
<section class="welcome">
  <h1>System status</h1>
  <p>Live state across every installed module. Auto-refresh every 15s.</p>
</section>
<div class="lbl"><h2>Modules (${s.installed.length})</h2><div class="ln"></div><span class="ct">platform ${esc(s.platform||'')}</span></div>
<section class="card-grid">${rows}</section>
<script>setTimeout(() => location.reload(), 15000)</script>`
  return pageShell(s, { title: 'Status', currentPath: '/status' }, body)
}

// /projects -- tracked projects with client-side status filters. Reads real
// project.json files; if none exist, explains how a project gets created (no
// fake rows). Filter groups map the status flow to the mockup's pills.
function renderProjectsPage(s) {
  const projects = loadProjects()
  // status -> {label, badgeClass, filterGroup}
  const META = {
    in_progress:   { label: 'IN PROGRESS',  cls: 'b-prog',  group: 'active' },
    review_needed: { label: 'NEEDS REVIEW', cls: 'b-rev',   group: 'review' },
    pending:       { label: 'PLANNING',     cls: 'b-pend',  group: 'active' },
    brief_ready:   { label: 'PLANNING',     cls: 'b-pend',  group: 'active' },
    approved:      { label: 'APPROVED',     cls: 'b-prog',  group: 'active' },
    blocked:       { label: 'BLOCKED',      cls: 'b-block', group: 'blocked' },
    deployed:      { label: 'DEPLOYED',     cls: 'b-done',  group: 'done' },
  }
  const grp = st => (META[st] || { group: 'active' }).group
  const counts = {
    all: projects.length,
    active: projects.filter(p => grp(p.status) === 'active').length,
    review: projects.filter(p => grp(p.status) === 'review').length,
    blocked: projects.filter(p => grp(p.status) === 'blocked').length,
    done: projects.filter(p => grp(p.status) === 'done').length,
  }

  if (!projects.length) {
    const body = `
<section class="welcome">
  <h1>Projects</h1>
  <p>Hand a goal to your assistant. It plans the work, builds it in stages, and holds it for your approval before anything ships.</p>
</section>
<div class="lbl"><h2>No projects yet</h2><div class="ln"></div></div>
<section class="card-grid">
  <div class="card"><h3>How to start</h3><p>Ask your assistant: "Create a project to &lt;goal&gt;." It writes a brief, breaks it into tasks, and it appears here with a live status.</p></div>
  <div class="card"><h3>Status flow</h3><p>planning &rarr; in progress &rarr; needs review &rarr; approved &rarr; deployed. Anything needing your input shows as blocked.</p></div>
</section>`
    return pageShell(s, { title: 'Projects', currentPath: '/projects' }, body)
  }

  const rows = projects.map(p => {
    const m = META[p.status] || { label: String(p.status || 'unknown').toUpperCase(), cls: 'b-pend', group: 'active' }
    const pct = p.tasks_total ? Math.round((p.tasks_done / p.tasks_total) * 100) : 0
    const trackCls = m.group === 'review' || m.group === 'done' ? ' gold' : ''
    const taskLabel = p.tasks_total ? `${p.tasks_done} / ${p.tasks_total} tasks` : 'no tasks yet'
    return `<a class="proj" href="/projects/${esc(p.id)}" data-group="${esc(m.group)}">
  <span class="badge ${m.cls}"><span class="bd"></span>${esc(m.label)}</span>
  <div class="pmid">
    <div class="pt">${esc(p.title)}</div>
    <div class="pd">${esc(p.description || '')}</div>
    <div class="prog"><div class="track"><i class="${trackCls.trim()}" style="width:${pct}%"></i></div><span class="tk">${esc(taskLabel)}</span></div>
  </div>
  <div class="pright"><div class="upd">${esc(p.updated || '')}</div></div>
</a>`
  }).join('\n')

  const fbtn = (g, label, n) => `<button data-f="${g}"${g === 'all' ? ' class="on"' : ''}>${label} · ${n}</button>`
  const body = `
<section class="welcome">
  <h1>Projects</h1>
  <p>Tracked work, each with its own brief, tasks, and approval gate. Filter by status below.</p>
</section>
<div class="pfilters">
  ${fbtn('all','All',counts.all)}${fbtn('active','Active',counts.active)}${fbtn('review','Needs review',counts.review)}${fbtn('blocked','Blocked',counts.blocked)}${fbtn('done','Done',counts.done)}
</div>
<section class="plist">${rows}</section>
<style>
.pfilters{display:flex;gap:9px;margin:6px 0 22px;flex-wrap:wrap}
.pfilters button{font-family:var(--mono);font-size:11.5px;padding:7px 14px;border-radius:20px;border:1px solid var(--rule);background:transparent;color:var(--muted);cursor:pointer;transition:.2s}
.pfilters button.on{color:var(--fg);border-color:var(--accent);background:rgba(123,104,238,.12)}
.pfilters button:hover{color:var(--fg)}
.plist{display:flex;flex-direction:column;gap:13px;margin-bottom:50px}
.proj{background:var(--elev);border:1px solid var(--rule);border-radius:14px;padding:18px 22px;display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:center;transition:.18s}
.proj:hover{border-color:var(--accent)}
a.proj{color:inherit;text-decoration:none;cursor:pointer}
.badge{font-family:var(--mono);font-size:10px;letter-spacing:.5px;padding:5px 11px;border-radius:20px;border:1px solid;white-space:nowrap;display:flex;align-items:center;gap:7px;align-self:flex-start}
.badge .bd{width:7px;height:7px;border-radius:50%}
.b-prog{color:var(--cyan);border-color:rgba(0,212,255,.4)}.b-prog .bd{background:var(--cyan);box-shadow:0 0 6px var(--cyan)}
.b-rev{color:var(--gold);border-color:rgba(212,175,55,.4)}.b-rev .bd{background:var(--gold);box-shadow:0 0 6px var(--gold)}
.b-pend{color:var(--brand);border-color:rgba(123,104,238,.4)}.b-pend .bd{background:var(--brand)}
.b-block{color:var(--red);border-color:rgba(255,92,92,.4)}.b-block .bd{background:var(--red);box-shadow:0 0 6px var(--red)}
.b-done{color:var(--green);border-color:rgba(0,255,136,.4)}.b-done .bd{background:var(--green);box-shadow:0 0 6px var(--green)}
.pmid .pt{font-weight:600;font-size:16px}.pmid .pd{color:var(--muted);font-size:13px;margin:3px 0 11px}
.prog{display:flex;align-items:center;gap:12px}.track{flex:1;max-width:280px;height:6px;background:var(--surface);border-radius:6px;overflow:hidden}.track i{display:block;height:100%;background:var(--grad);border-radius:6px}.track i.gold{background:linear-gradient(90deg,var(--accent),var(--gold))}
.prog .tk{font-family:var(--mono);font-size:11px;color:var(--muted)}
.pright{text-align:right}.pright .upd{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
@media(max-width:820px){.proj{grid-template-columns:1fr;gap:12px}.pright{text-align:left}.track{max-width:none}}
</style>
<script>
(function(){
  var btns=document.querySelectorAll('.pfilters button'), rows=document.querySelectorAll('.proj');
  btns.forEach(function(b){b.addEventListener('click',function(){
    btns.forEach(function(x){x.classList.remove('on')}); b.classList.add('on');
    var f=b.dataset.f;
    rows.forEach(function(r){ r.style.display=(f==='all'||r.dataset.group===f)?'':'none'; });
  });});
})();
</script>`
  return pageShell(s, { title: 'Projects', currentPath: '/projects' }, body)
}

// /projects/<id> -- single project detail: tasks + brief. _PROJECT_DETAIL_V1
function renderProjectDetailPage(s, id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_.-]/g, '')
  const dir = path.join(INSTALL_PATH, 'projects', safe)
  let j = null
  try { j = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) } catch {}
  if (!j) {
    return pageShell(s, { title: 'Project', currentPath: '/projects' },
      `<section class="welcome"><p><a href="/projects">&larr; All projects</a></p><h1>Project not found</h1><p>No project.json for <code>${esc(safe)}</code>.</p></section>`)
  }
  const tasks = Array.isArray(j.tasks) ? j.tasks : []
  const STMAP = { complete:'b-done', done:'b-done', deployed:'b-done', in_progress:'b-prog', pending:'b-pend', blocked:'b-block', review_needed:'b-rev' }
  const taskRows = tasks.length ? tasks.map(t => {
    const cls = STMAP[t.status] || 'b-pend'
    const extra = [t.note, t.needs ? ('needs: ' + t.needs) : ''].filter(Boolean).join(' — ')
    return `<tr><td class="mono">${esc(t.id||'')}</td><td>${esc(t.title||t.description||'')}${extra?`<div class="tnote">${esc(extra)}</div>`:''}</td><td><span class="badge ${cls}"><span class="bd"></span>${esc(String(t.status||'pending').toUpperCase())}</span></td></tr>`
  }).join('') : `<tr><td colspan="3" style="color:var(--muted)">No tasks defined.</td></tr>`
  let brief = ''
  for (const f of ['BRIEF.md','SCOPE.md','brief.md']) {
    try { const c = fs.readFileSync(path.join(dir, f), 'utf8'); brief = `<details class="brief"><summary>${esc(f)}</summary><pre>${esc(c.slice(0,8000))}</pre></details>`; break } catch {}
  }
  const body = `
<section class="welcome"><p><a href="/projects">&larr; All projects</a></p>
  <h1>${esc(j.title || j.id || safe)}</h1>
  <p>${esc(j.description || '')}</p>
  <p class="mono" style="color:var(--muted)">status: ${esc(j.status||'pending')} · ${tasks.length} task${tasks.length===1?'':'s'}</p>
</section>
<section><table class="ptbl"><thead><tr><th>Task</th><th>Title</th><th>Status</th></tr></thead><tbody>${taskRows}</tbody></table></section>
${brief}
<style>
.ptbl{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:24px}
.ptbl th,.ptbl td{border-bottom:1px solid var(--rule);padding:9px 12px;text-align:left;vertical-align:top}
.ptbl th{color:var(--muted);font-family:var(--mono);font-size:11px;letter-spacing:.5px}
.tnote{color:var(--muted);font-size:12px;margin-top:3px}
.brief summary{cursor:pointer;color:var(--accent);font-family:var(--mono);font-size:12px;margin:8px 0}
.brief pre{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:14px;overflow:auto;font-size:12px;white-space:pre-wrap}
.mono{font-family:var(--mono)}
</style>`
  return pageShell(s, { title: j.title || 'Project', currentPath: '/projects' }, body)
}

// /skills -- the installed skills library. Real SKILL.md files only; if none are
// installed, says so honestly (no fabricated entries).
function renderSkillsPage(s) {
  const skills = loadSkills()
  let body
  if (skills.length) {
    const cards = skills.map(k => `<div class="card">
  <h3>${esc(k.name)}${k.version ? ` <span class="lt-port">v${esc(k.version)}</span>` : ''}</h3>
  <p style="color:var(--muted);font-size:12px;font-family:var(--mono);margin-bottom:12px">${esc(k.id)}</p>
  <p>${esc(k.description || 'No description provided.')}</p>
</div>`).join('\n')
    body = `
<section class="welcome">
  <h1>Skills</h1>
  <p>Reusable skill primitives your assistant and agents can call. Each is a self-contained, tenant-agnostic capability.</p>
</section>
<div class="lbl"><h2>${skills.length} skill${skills.length===1?'':'s'} installed</h2><div class="ln"></div><span class="ct">shared/skills/library</span></div>
<section class="card-grid">${cards}</section>`
  } else {
    body = `
<section class="welcome">
  <h1>Skills</h1>
  <p>No skills are installed yet. The skills-library module is a core module; re-run the installer or add it to populate this library.</p>
</section>`
  }
  return pageShell(s, { title: 'Skills', currentPath: '/skills' }, body)
}

// /subsystems -- inventory + capabilities, grouped by tier, from the module
// registry joined with live service state. This is the public equivalent of the
// internal subsystems/capabilities view.
function renderSubsystemsPage(s) {
  const reg = loadRegistry()
  const liveByName = Object.fromEntries(s.installed.map(m => [m.name, m]))
  const TIERS = [
    { key: 'core',             label: 'Core',             note: 'always installed' },
    { key: 'official',         label: 'Official',         note: 'opt-in, maintained' },
    { key: 'community-vetted', label: 'Community (vetted)', note: 'reviewed contributions' },
    { key: 'experimental',     label: 'Experimental',     note: 'use with care' },
  ]
  const kindCounts = {}
  for (const r of reg) kindCounts[r.kind || 'other'] = (kindCounts[r.kind || 'other'] || 0) + 1
  const capChips = Object.entries(kindCounts).map(([k, n]) =>
    `<span>${esc(k)} <b style="color:var(--cyan)">${n}</b></span>`).join('')

  const sections = TIERS.map(t => {
    const rows = reg.filter(r => (r.tier || 'experimental') === t.key)
    if (!rows.length) return ''
    const cards = rows.map(r => {
      const live = liveByName[r.name]
      const st = live ? stateOf(live) : { s: r.kind === 'service' ? 'not installed' : 'config', cls: r.kind === 'service' ? 'down' : 'warn' }
      return `<div class="card">
  <h3><span class="dot ${st.cls === 'ok' ? 'on' : (st.cls === 'warn' ? 'warn' : 'off')}"></span>${esc(pretty(r.name))}</h3>
  <p style="color:var(--muted);font-size:11px;font-family:var(--mono);margin-bottom:10px">${esc(r.kind || '')}</p>
  <p>${esc(r.purpose || '')}</p>
  <div class="row"><span class="k">State</span><span class="v ${st.cls}">${esc(st.s)}</span></div>
</div>`
    }).join('\n')
    return `<div class="lbl"><h2>${esc(t.label)}</h2><div class="ln"></div><span class="ct">${esc(t.note)} · ${rows.length}</span></div>
<section class="card-grid">${cards}</section>`
  }).join('\n')

  const body = `
<section class="welcome">
  <h1>Subsystems &amp; capabilities</h1>
  <p>Every subsystem this build knows about, grouped by tier, joined with live service state. ${reg.length} registered.</p>
</section>
<div class="lbl"><h2>Capabilities</h2><div class="ln"></div><span class="ct">by kind</span></div>
<section><div class="mods" style="margin-bottom:30px">${capChips || '<span class="off">none</span>'}</div></section>
${sections || '<div class="placeholder">Module registry not found.</div>'}`
  return pageShell(s, { title: 'Subsystems', currentPath: '/subsystems' }, body)
}

// /activation -- the public per-agent activation card. Toggle tools / skills /
// modules on or off for the assistant; each toggle persists to agent-activation.json
// and the personal-ai runtime honours tools_active on the next turn. _PUBLIC_ACTIVATION_V1
function renderActivationPage(s) {
  const agentId = 'muse'
  const d = activationData(agentId)
  const tierBlock = (tier, label, note) => {
    const items = d.catalogue[tier]
    const active = new Set(d.active[tier])
    if (!items.length) {
      return `<div class="lbl"><h2>${esc(label)}</h2><div class="ln"></div><span class="ct">${esc(note)} · 0</span></div>
<section><div class="placeholder">None available in this build.</div></section>`
    }
    const pills = items.map(name => {
      const on = active.has(name)
      return `<button class="apill ${on ? 'on' : 'off'}" data-tier="${esc(tier)}" data-item="${esc(name)}" data-on="${on ? '1' : '0'}">
  <span class="adot"></span><span class="alabel">${esc(name)}</span><span class="astate">${on ? 'ON' : 'OFF'}</span>
</button>`
    }).join('')
    return `<div class="lbl"><h2>${esc(label)}</h2><div class="ln"></div><span class="ct">${esc(note)} · ${active.size}/${items.length} on</span></div>
<section class="apills">${pills}</section>`
  }
  const body = `
<section class="welcome">
  <h1>Activation</h1>
  <p>Turn capabilities on or off for <b>${esc(d.display_name)}</b>. Each toggle persists immediately and the assistant honours it on its next turn. This is your per-agent capability knob.</p>
</section>
<div class="acard">
  <div class="ahead"><span class="dot on"></span><div><div class="aname">${esc(d.display_name)}</div><div class="aprincipal">${esc(d.principal_type)}</div></div></div>
</div>
${tierBlock('tools', 'Tools', 'assistant-callable functions')}
${tierBlock('skills', 'Skills', 'packaged skills')}
${tierBlock('modules', 'Modules', 'installed capability modules')}
<style>
.acard{background:var(--elev);border:1px solid var(--rule);border-radius:14px;padding:18px 20px;margin-bottom:8px}
.ahead{display:flex;align-items:center;gap:14px}
.aname{font-weight:600;font-size:17px}.aprincipal{font-family:var(--mono);font-size:11px;color:var(--muted)}
.apills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:34px}
.apill{display:flex;align-items:center;gap:9px;font-family:var(--mono);font-size:11.5px;padding:7px 12px;border-radius:8px;border:1px solid var(--rule);background:var(--surface);color:var(--fg-soft);cursor:pointer;transition:.15s}
.apill:hover{border-color:var(--accent)}
.apill .adot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.apill.on{border-color:rgba(0,255,136,.4);color:var(--fg)}
.apill.on .adot{background:var(--green);box-shadow:0 0 6px var(--green)}
.apill .astate{font-size:9.5px;letter-spacing:1px;color:var(--muted)}
.apill.on .astate{color:var(--green)}
.apill.busy{opacity:.5;pointer-events:none}
.atoast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:10px 16px;font-family:var(--mono);font-size:12px;color:var(--fg);z-index:50;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.atoast.err{border-color:rgba(255,92,92,.5);color:var(--red)}
</style>
<script>
(function(){
  var AGENT='${esc(agentId)}';
  function toast(msg, err){var t=document.createElement('div');t.className='atoast'+(err?' err':'');t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove()},2600);}
  document.querySelectorAll('.apill').forEach(function(b){
    b.addEventListener('click', function(){
      var tier=b.dataset.tier, item=b.dataset.item, on=b.dataset.on==='1';
      var action=on?'deactivate':'activate';
      b.classList.add('busy');
      fetch('/api/activation/'+AGENT+'/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:tier,item:item,action:action})})
        .then(function(r){return r.json()})
        .then(function(j){
          b.classList.remove('busy');
          if(j.error){toast(j.error,true);return;}
          on=!on; b.dataset.on=on?'1':'0';
          b.classList.toggle('on',on); b.classList.toggle('off',!on);
          b.querySelector('.astate').textContent=on?'ON':'OFF';
          toast(item+' '+(on?'enabled':'disabled'));
        })
        .catch(function(e){b.classList.remove('busy');toast(String(e),true);});
    });
  });
})();
</script>`
  return pageShell(s, { title: 'Activation', currentPath: '/activation' }, body)
}

// /memory -- admin view of what the assistant remembers (facts, drops, tasks).
// Read-only. Reads the live memory.db; if absent or empty, says so plainly.
async function renderMemoryPage(s) {
  const mem = await loadAdminMemory()
  if (!mem.available) {
    const body = `
<section class="welcome">
  <h1>Memory</h1>
  <p>No memory store found yet at <code>${esc(mem.path)}</code>. It is created the first time your assistant runs.</p>
</section>`
    return pageShell(s, { title: 'Memory', currentPath: '/memory' }, body)
  }
  const countChips = Object.entries(mem.tables).map(([t, n]) =>
    `<span>${esc(t)} <b style="color:var(--cyan)">${n}</b></span>`).join('')
  const rowsOf = (arr, cols) => arr.length
    ? arr.map(r => `<div class="card" style="padding:14px">${cols.map(c => r[c] != null && r[c] !== ''
        ? `<div class="row"><span class="k">${esc(c)}</span><span class="v">${esc(String(r[c]).slice(0,160))}</span></div>` : '').join('')}</div>`).join('\n')
    : '<div class="placeholder">None recorded yet.</div>'
  const body = `
<section class="welcome">
  <h1>Memory</h1>
  <p>What your assistant remembers, for you to review. Read-only here; manage facts and drops from the Assistant.</p>
</section>
<div class="lbl"><h2>Store</h2><div class="ln"></div><span class="ct">${esc(path.basename(mem.path))}</span></div>
<section><div class="mods" style="margin-bottom:24px">${countChips || '<span class="off">empty</span>'}</div></section>
<div class="lbl"><h2>Important facts</h2><div class="ln"></div></div>
<section class="card-grid">${rowsOf(mem.facts, ['fact','content','text','value','created_at'])}</section>
<div class="lbl"><h2>Drops</h2><div class="ln"></div></div>
<section class="card-grid">${rowsOf(mem.drops, ['title','content','text','url','created_at'])}</section>
<div class="lbl"><h2>Tasks</h2><div class="ln"></div></div>
<section class="card-grid">${rowsOf(mem.tasks, ['title','status','due','created_at'])}</section>`
  return pageShell(s, { title: 'Memory', currentPath: '/memory' }, body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (url.pathname === '/api/health') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true,time:new Date().toISOString()})); return }
    if (url.pathname === '/api/status') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(s, null, 2)); return }
    if (url.pathname === '/api/update-status') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(readUpdateStatus() || { available: false })); return }
    if (url.pathname === '/') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderHtml(s)); return }
    if (url.pathname === '/modules') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderModulesPage(s)); return }
    if (url.pathname === '/status') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderStatusPage(s)); return }
    if (url.pathname === '/projects') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderProjectsPage(s)); return }
    if (url.pathname.startsWith('/projects/')) { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderProjectDetailPage(s, decodeURIComponent(url.pathname.slice('/projects/'.length)))); return }
    if (url.pathname === '/skills') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderSkillsPage(s)); return }
    if (url.pathname === '/subsystems') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderSubsystemsPage(s)); return }
    if (url.pathname === '/memory') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(await renderMemoryPage(s)); return }
    if (url.pathname === '/activation') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderActivationPage(s)); return }
    // Activation API (catalogue data layer + per-agent toggle that persists + gates)
    const actGet = url.pathname.match(/^\/api\/activation\/([a-z0-9_-]+)$/)
    if (actGet && req.method === 'GET') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(activationData(actGet[1]), null, 2)); return }
    const actTog = url.pathname.match(/^\/api\/activation\/([a-z0-9_-]+)\/toggle$/)
    if (actTog && req.method === 'POST') {
      let raw = ''
      for await (const c of req) raw += c
      let body; try { body = JSON.parse(raw || '{}') } catch { res.writeHead(400, {'content-type':'application/json'}); res.end(JSON.stringify({ error: 'invalid json' })); return }
      const r = toggleActivation(actTog[1], body.tier, body.item, body.action)
      res.writeHead(r.error ? 400 : 200, {'content-type':'application/json'}); res.end(JSON.stringify(r)); return
    }
    if (url.pathname === '/api/skills') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(loadSkills(), null, 2)); return }
    if (url.pathname === '/api/subsystems') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(loadRegistry(), null, 2)); return }
    res.writeHead(404, {'content-type':'text/plain'}); res.end('not found')
  } catch (e) { res.writeHead(500); res.end(`error: ${e.message}`) }
})

server.listen(PORT, BIND, () => {
  console.log(`[dashboard] listening on http://${BIND}:${PORT}`)
  console.log(`[dashboard] install path: ${INSTALL_PATH}`)
  console.log(`[dashboard] daemon prefix: ${PREFIX}`)
})
