#!/usr/bin/env node
// pbox-personal-sensor.mjs -- ambient signal daemon for Pandoras Box.
// Resident process: scans every SCAN_INTERVAL_MS, fans events out over SSE.
// Hard rules: read-only HTTP, localhost-only bind, execFile (no shell), zero
// external deps beyond Node 22 builtins.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.PERSONAL_SENSOR_SSE_PORT || '8489', 10)
const BIND = '127.0.0.1'
const SCAN_INTERVAL_MS = parseInt(process.env.PERSONAL_SENSOR_SCAN_MS || '600000', 10)
const GEOFENCE_ENABLED = process.env.PERSONAL_SENSOR_GEOFENCE === '1'

const STORE_DIR = path.join(INSTALL_PATH, 'personal-sensor', 'store')
const EVENTS_LOG = path.join(STORE_DIR, 'events.jsonl')
const EVENTS_LOG_PREV = path.join(STORE_DIR, 'events.1.jsonl')
const PLACES_FILE = path.join(INSTALL_PATH, 'personal-sensor', 'places.json')
const LOG_MAX_BYTES = 10 * 1024 * 1024
const STARTING_SOON_MIN = 20
const FREE_GAP_MIN = 30
const WORKING_HOURS = 8
const MS = { min: 60_000, hour: 3_600_000 }

const MAIL_MS365_ENV = path.join(INSTALL_PATH, 'mail-ms365', '.env')
const MAIL_GOOGLE_ENV = path.join(INSTALL_PATH, 'mail-google', '.env')

const log = (...a) => console.log(`[personal-sensor] ${new Date().toISOString()}`, ...a)
const warn = (...a) => console.warn(`[personal-sensor] WARN`, ...a)

function ensureStore() {
  try { fs.mkdirSync(STORE_DIR, { recursive: true }) } catch {}
}

function parseEnv(p) {
  const out = {}
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  } catch {}
  return out
}

// Token-shaped key surface: any var ending in _TOKEN/_ACCESS_TOKEN/_REFRESH_TOKEN.
function firstTokenIn(env) {
  for (const k of Object.keys(env)) {
    if (/(^|_)ACCESS_TOKEN$|(^|_)TOKEN$|(^|_)REFRESH_TOKEN$/.test(k) && env[k]) return { key: k, value: env[k] }
  }
  return null
}

// --- Persistent log ---------------------------------------------------------

function rotateIfNeeded() {
  try {
    const st = fs.statSync(EVENTS_LOG)
    if (st.size >= LOG_MAX_BYTES) {
      try { fs.rmSync(EVENTS_LOG_PREV, { force: true }) } catch {}
      fs.renameSync(EVENTS_LOG, EVENTS_LOG_PREV)
    }
  } catch {}
}

function persistEvent(ev) {
  rotateIfNeeded()
  try { fs.appendFileSync(EVENTS_LOG, JSON.stringify(ev) + '\n') } catch (e) { warn('persist failed', e.message) }
}

// --- SSE bus ----------------------------------------------------------------

const clients = new Set()
function broadcast(ev) {
  const payload = `data: ${JSON.stringify(ev)}\n\n`
  for (const res of clients) {
    try { res.write(payload) } catch {}
  }
}

function emit(kind, source, payload) {
  const ev = { ts: new Date().toISOString(), id: randomUUID(), kind, source, payload: payload || {} }
  persistEvent(ev)
  broadcast(ev)
  log('emit', kind, source)
  return ev
}

// Warn-once dedup so we don't spam unavailability per scan within a single run.
const warnedThisScan = new Set()
function scanReset() { warnedThisScan.clear() }
function emitOnce(kind, source, payload) {
  const key = `${kind}:${source}`
  if (warnedThisScan.has(key)) return
  warnedThisScan.add(key)
  emit(kind, source, payload)
}

// --- HTTPS helper (Node builtin, no shell) ---------------------------------

function fetchJson(url, headers, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    import('node:https').then(({ default: https }) => {
      const u = new URL(url)
      const req = https.request({
        host: u.host, path: u.pathname + u.search, method: 'GET',
        headers: { 'Accept': 'application/json', ...headers },
        timeout: timeoutMs,
      }, res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0,200)}`))
          try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(new Error('timeout')) })
      req.end()
    }).catch(reject)
  })
}

// --- Calendar sources -------------------------------------------------------

function inferSourceKind(envPath) {
  if (envPath.includes('mail-ms365')) return 'ms365'
  if (envPath.includes('mail-google')) return 'google'
  return 'unknown'
}

async function fetchMs365Events(token) {
  const now = new Date()
  const end = new Date(now.getTime() + 24 * MS.hour)
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}&$orderby=start/dateTime&$top=50`
  const j = await fetchJson(url, { Authorization: `Bearer ${token}` })
  return (j.value || []).map(e => ({
    id: e.id, title: e.subject || '(no title)',
    start: e.start?.dateTime ? new Date(e.start.dateTime + (e.start.timeZone === 'UTC' ? 'Z' : '')).toISOString() : null,
    end: e.end?.dateTime ? new Date(e.end.dateTime + (e.end.timeZone === 'UTC' ? 'Z' : '')).toISOString() : null,
    location: e.location?.displayName || null,
  })).filter(e => e.start && e.end)
}

async function fetchGoogleEvents(token) {
  const now = new Date()
  const end = new Date(now.getTime() + 24 * MS.hour)
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}&maxResults=50`
  const j = await fetchJson(url, { Authorization: `Bearer ${token}` })
  return (j.items || []).map(e => ({
    id: e.id, title: e.summary || '(no title)',
    start: e.start?.dateTime || (e.start?.date ? new Date(e.start.date).toISOString() : null),
    end: e.end?.dateTime || (e.end?.date ? new Date(e.end.date).toISOString() : null),
    location: e.location || null,
  })).filter(e => e.start && e.end)
}

async function scanCalendar() {
  const candidates = [
    { path: MAIL_MS365_ENV, kind: 'ms365' },
    { path: MAIL_GOOGLE_ENV, kind: 'google' },
  ].filter(c => fs.existsSync(c.path))
  if (candidates.length === 0) {
    emitOnce('calendar_unavailable', 'calendar', { reason: 'no_mail_module_env' })
    return []
  }
  const allEvents = []
  for (const c of candidates) {
    const env = parseEnv(c.path)
    const tok = firstTokenIn(env)
    if (!tok) {
      emitOnce('calendar_unavailable', `calendar:${c.kind}`, { reason: 'no_token_in_env', env_path: c.path })
      continue
    }
    try {
      const events = c.kind === 'ms365' ? await fetchMs365Events(tok.value) : await fetchGoogleEvents(tok.value)
      for (const e of events) allEvents.push({ ...e, source_kind: c.kind })
    } catch (e) {
      emitOnce('calendar_unavailable', `calendar:${c.kind}`, { reason: 'fetch_failed', detail: e.message.slice(0, 200) })
    }
  }
  return allEvents
}

// --- Free-time gap derivation ----------------------------------------------

function deriveGaps(events) {
  const now = Date.now()
  const horizon = now + WORKING_HOURS * MS.hour
  const inWindow = events
    .map(e => ({ s: Date.parse(e.start), e: Date.parse(e.end), title: e.title }))
    .filter(b => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > now && b.s < horizon)
    .sort((a, b) => a.s - b.s)
  const gaps = []
  let cursor = now
  for (const b of inWindow) {
    if (b.s > cursor + FREE_GAP_MIN * MS.min) {
      gaps.push({ start: new Date(cursor).toISOString(), end: new Date(b.s).toISOString(), minutes: Math.round((b.s - cursor) / MS.min) })
    }
    cursor = Math.max(cursor, b.e)
  }
  if (horizon > cursor + FREE_GAP_MIN * MS.min) {
    gaps.push({ start: new Date(cursor).toISOString(), end: new Date(horizon).toISOString(), minutes: Math.round((horizon - cursor) / MS.min) })
  }
  return gaps
}

function emitCalendarSignals(events) {
  const now = Date.now()
  for (const e of events) {
    const start = Date.parse(e.start)
    if (!Number.isFinite(start)) continue
    const minsToStart = (start - now) / MS.min
    if (minsToStart > 0 && minsToStart <= STARTING_SOON_MIN) {
      emit('calendar_event_starting_soon', `calendar:${e.source_kind}`, { id: e.id, title: e.title, start: e.start, end: e.end, location: e.location, minutes_to_start: Math.round(minsToStart) })
    } else if (minsToStart > STARTING_SOON_MIN && minsToStart <= 24 * 60) {
      emit('calendar_event_upcoming', `calendar:${e.source_kind}`, { id: e.id, title: e.title, start: e.start, end: e.end, location: e.location })
    }
  }
  for (const g of deriveGaps(events)) {
    emit('free_time_gap', 'calendar', g)
  }
}

// --- Geofence ---------------------------------------------------------------

let lastPlace = null

function readPlaces() {
  try { return JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8')) } catch { return [] }
}

function haversineMeters(a, b) {
  const R = 6_371_000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function runCoreLocation() {
  return new Promise(resolve => {
    execFile('corelocationcli', ['-once'], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null)
      // Output format: "lat, lon" (corelocationcli default). Be tolerant.
      const m = String(stdout).match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/)
      if (!m) return resolve(null)
      resolve({ lat: parseFloat(m[1]), lon: parseFloat(m[2]) })
    })
  })
}

function commandExists(cmd) {
  return new Promise(resolve => {
    execFile('/usr/bin/which', [cmd], { timeout: 2000 }, err => resolve(!err))
  })
}

async function scanGeofence() {
  if (!GEOFENCE_ENABLED) return
  if (!await commandExists('corelocationcli')) {
    emitOnce('geofence_unavailable', 'geofence', { reason: 'corelocationcli_missing', hint: 'brew install corelocationcli' })
    return
  }
  const fix = await runCoreLocation()
  if (!fix) {
    emitOnce('geofence_unavailable', 'geofence', { reason: 'no_fix' })
    return
  }
  const places = readPlaces()
  let inside = null
  for (const p of places) {
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue
    const radius = p.radius_m || 150
    if (haversineMeters(fix, p) <= radius) { inside = p.name; break }
  }
  if (inside !== lastPlace) {
    if (inside) emit('geofence_entered', 'geofence', { place: inside, lat: fix.lat, lon: fix.lon })
    else if (lastPlace) emit('geofence_left', 'geofence', { place: lastPlace, lat: fix.lat, lon: fix.lon })
    lastPlace = inside
  }
}

// --- Scan orchestration -----------------------------------------------------

let scanInFlight = false
async function runScan() {
  if (scanInFlight) return
  scanInFlight = true
  scanReset()
  try {
    const events = await scanCalendar()
    if (events.length) emitCalendarSignals(events)
    await scanGeofence()
  } catch (e) {
    warn('scan error', e.message)
  } finally {
    scanInFlight = false
  }
}

// --- HTTP / SSE server ------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' }); res.end('method not allowed'); return
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, clients: clients.size, scan_in_flight: scanInFlight, scan_interval_ms: SCAN_INTERVAL_MS }))
    return
  }
  if (url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(`: connected ${new Date().toISOString()}\n\n`)
    clients.add(res)
    const ka = setInterval(() => { try { res.write(': keepalive\n\n') } catch {} }, 30_000)
    req.on('close', () => { clearInterval(ka); clients.delete(res) })
    return
  }
  if (url.pathname === '/recent') {
    // Read last N events from the persistent log. No write paths exposed.
    const n = Math.min(parseInt(url.searchParams.get('n') || '50', 10), 500)
    try {
      const lines = fs.readFileSync(EVENTS_LOG, 'utf8').trim().split('\n').filter(Boolean)
      const slice = lines.slice(-n).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(slice))
    } catch {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]')
    }
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found')
})

function start() {
  ensureStore()
  server.listen(PORT, BIND, () => {
    log(`listening on http://${BIND}:${PORT}`)
    log(`scan interval: ${SCAN_INTERVAL_MS}ms  geofence: ${GEOFENCE_ENABLED}`)
    runScan()
    setInterval(runScan, SCAN_INTERVAL_MS)
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log(`shutting down on ${sig}`); server.close(() => process.exit(0)) })
}

start()
