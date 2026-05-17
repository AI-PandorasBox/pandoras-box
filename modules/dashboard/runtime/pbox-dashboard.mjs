#!/usr/bin/env node
// pbox-dashboard.mjs -- Pandoras Box service-status dashboard
// Localhost-only HTTP server. GET / for HTML, /api/status for JSON.
// Security: execFile only (no shell). Daemon prefix from theme.conf is
// operator-controlled; we never interpolate into a shell string.

import http from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.DASHBOARD_PORT || '8181', 10)
const BIND = process.env.DASHBOARD_BIND || '127.0.0.1'

function readThemePrefix() {
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = conf.match(/^LAUNCHDAEMON_PREFIX=["']?([^"'\n]+)["']?$/m)
    return m ? m[1] : 'com.pandoras-box'
  } catch { return 'com.pandoras-box' }
}
const PREFIX = readThemePrefix()

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

function launchctlList() {
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
      pid: pid === '-' ? null : parseInt(pid, 10),
      last_exit: exit === '-' ? null : parseInt(exit, 10),
      running: pid !== '-' && pid !== '0',
    })
  }
  return out
}

async function probeHttp(env) {
  const keys = ['PORT','DASHBOARD_PORT','DOCS_PORT','MUSE_PORT','PERSONAL_AI_PORT',
                'TERMINAL_PORT','ADMIN_LITE_PORT','CONTENT_CLASSIFIER_PORT',
                'OFFLINE_KB_PORT','MEDIA_PRODUCTION_PORT','SELF_IMPROVEMENT_PORT']
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

async function gatherStatus() {
  const services = launchctlList()
  const modules = discoverModules()
  const installed = []
  for (const m of modules) {
    const env = parseEnv(m.env)
    const label = `${PREFIX}.${m.name}`
    const svc = services.find(s => s.label === label) || null
    const probe = await probeHttp(env)
    installed.push({
      name: m.name, label,
      registered: !!svc, running: svc?.running ?? false,
      pid: svc?.pid ?? null, last_exit: svc?.last_exit ?? null,
      port: probe.port, http: probe.http,
    })
  }
  return {
    install_path: INSTALL_PATH, prefix: PREFIX,
    generated_at: new Date().toISOString(),
    installed,
    other_services: services.filter(s => !installed.some(m => m.label === s.label)),
  }
}

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

function renderHtml(s) {
  const rows = s.installed.map(m => {
    const state = !m.registered ? 'NOT REGISTERED' : !m.running ? 'STOPPED'
                : (m.port && m.http >= 200 && m.http < 400) ? 'RUNNING'
                : (m.port && !m.http) ? 'BIND FAILED' : 'RUNNING'
    const col = state === 'RUNNING' ? '#0a0' : state === 'BIND FAILED' ? '#d80' : '#c00'
    return `<tr><td><strong>${esc(m.name)}</strong></td><td><span style="color:${col};font-weight:600">${state}</span></td><td>${m.pid?`pid ${m.pid}`:'-'}</td><td>${m.port?`:${m.port}`:'-'}</td><td>${m.http!=null?`HTTP ${m.http}`:'-'}</td><td><code style="font-size:11px;color:#666">${esc(m.label)}</code></td></tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Pandoras Box Dashboard</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:24px 32px;background:#fafafa;color:#222}h1{font-size:1.5rem;margin:0 0 6px}.meta{color:#888;font-size:13px;margin-bottom:24px}table{width:100%;border-collapse:collapse;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05)}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #eee;font-size:14px}th{background:#f5f5f5;font-weight:600}tr:last-child td{border-bottom:none}.footer{margin-top:18px;color:#888;font-size:12px}</style></head><body><h1>Pandoras Box Dashboard</h1><div class="meta">Install: <code>${esc(s.install_path)}</code> &middot; Prefix: <code>${esc(s.prefix)}</code> &middot; Refreshed: ${esc(s.generated_at)}</div>${s.installed.length===0?'<p style="color:#888"><em>No modules installed yet -- run pbox-setup.sh.</em></p>':`<table><thead><tr><th>Module</th><th>State</th><th>PID</th><th>Port</th><th>HTTP</th><th>Daemon label</th></tr></thead><tbody>${rows}</tbody></table>`}<div class="footer">JSON: <a href="/api/status">/api/status</a> &middot; Health: <a href="/api/health">/api/health</a></div></body></html>`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (url.pathname === '/api/health') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true,time:new Date().toISOString()})); return }
    if (url.pathname === '/api/status') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(s, null, 2)); return }
    if (url.pathname === '/') { const s = await gatherStatus(); res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(renderHtml(s)); return }
    res.writeHead(404, {'content-type':'text/plain'}); res.end('not found')
  } catch (e) { res.writeHead(500); res.end(`error: ${e.message}`) }
})

server.listen(PORT, BIND, () => {
  console.log(`[dashboard] listening on http://${BIND}:${PORT}`)
  console.log(`[dashboard] install path: ${INSTALL_PATH}`)
  console.log(`[dashboard] daemon prefix: ${PREFIX}`)
})
