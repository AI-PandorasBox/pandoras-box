#!/usr/bin/env node
// DEMO-ONLY. NOT FINANCIAL ADVICE.
// This module reads IG demo-account positions and computes deterministic
// signal indicators for display. It does NOT place orders, ever.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Hard gate: refuse to start if the operator has flipped the live switch.
// String equality only - we never want to be tolerant about live trading.
if (process.env.IG_LIVE === 'true') {
  console.error('FATAL: IG_LIVE=true detected. This module is demo-only. Exiting.')
  process.exit(1)
}

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.TRADING_RESEARCH_PORT || '8487', 10)
const BIND = '127.0.0.1' // hard-coded; module is localhost-only by design

// Demo subdomain is intentional and cannot be overridden by environment.
// A typo or env-spoof must never accidentally point this at live-api.ig.com.
const IG_BASE = 'https://demo-api.ig.com/gateway/deal'

const WATCHLIST_PATH = path.join(INSTALL_PATH, 'trading-research', 'store', 'watchlist.json')
const PUBLIC_DIR = path.join(__dirname, 'public')

const POLL_MS = 60_000

// ---------------------------------------------------------------------------
// Theme accent (read once from theme.conf; injected into the page so the
// banner inherits the operator's chosen colour without a build step).
function readThemeAccent() {
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = conf.match(/^COLOR_ACCENT=["']?([^"'\n]+)["']?$/m)
    return m ? m[1] : '#c79a2b'
  } catch { return '#c79a2b' }
}
const THEME_ACCENT = readThemeAccent()

// ---------------------------------------------------------------------------
// Watchlist (operator-edited file). We re-read on every poll so edits land
// without a service restart.
function readWatchlist() {
  try {
    const raw = fs.readFileSync(WATCHLIST_PATH, 'utf8')
    const j = JSON.parse(raw)
    if (!Array.isArray(j.epics)) return []
    return j.epics.filter(e => typeof e === 'string' && /^[A-Z0-9._-]+$/.test(e))
  } catch { return [] }
}

// ---------------------------------------------------------------------------
// IG REST session. Tokens live in memory only. Re-login on 401.
let session = { cst: null, xst: null, accountId: null, loggedInAt: 0 }

async function igLogin() {
  const username = process.env.IG_USERNAME
  const password = process.env.IG_PASSWORD
  const apiKey = process.env.IG_API_KEY
  if (!username || !password || !apiKey) {
    throw new Error('IG credentials missing (IG_USERNAME / IG_PASSWORD / IG_API_KEY)')
  }
  const res = await fetch(`${IG_BASE}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json; charset=UTF-8',
      'X-IG-API-KEY': apiKey,
      'Version': '2',
    },
    body: JSON.stringify({ identifier: username, password }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG login failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  const cst = res.headers.get('cst')
  const xst = res.headers.get('x-security-token')
  if (!cst || !xst) throw new Error('IG login missing session headers')
  let accountId = null
  try {
    const body = await res.json()
    accountId = body?.currentAccountId ?? null
  } catch {}
  session = { cst, xst, accountId, loggedInAt: Date.now() }
  return session
}

async function igGet(pathSuffix, version = '1') {
  if (!session.cst || !session.xst) await igLogin()
  const apiKey = process.env.IG_API_KEY
  const doFetch = () => fetch(`${IG_BASE}${pathSuffix}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json; charset=UTF-8',
      'X-IG-API-KEY': apiKey,
      'CST': session.cst,
      'X-SECURITY-TOKEN': session.xst,
      'Version': version,
    },
  })
  let res = await doFetch()
  if (res.status === 401) {
    // Single retry after re-login. If still 401, surface the error.
    await igLogin()
    res = await doFetch()
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG GET ${pathSuffix} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function fetchAccounts() {
  return igGet('/accounts', '1')
}

async function fetchPositions() {
  return igGet('/positions', '2')
}

async function fetchPrices(epic) {
  // 200 MINUTE bars is enough for a 50/200 MA crossover on minute bars.
  // (Educational; the module makes no claim about MA crossovers being useful.)
  return igGet(`/prices/${encodeURIComponent(epic)}/MINUTE/200`, '3')
}

// ---------------------------------------------------------------------------
// Deterministic indicator: 50/200 moving average crossover on close prices.
function movingAverage(arr, n) {
  if (arr.length < n) return null
  let sum = 0
  for (let i = arr.length - n; i < arr.length; i++) sum += arr[i]
  return sum / n
}

function classifyCrossover(closes) {
  if (closes.length < 200) return { signal: 'insufficient_data', ma50: null, ma200: null }
  const ma50 = movingAverage(closes, 50)
  const ma200 = movingAverage(closes, 200)
  let signal = 'neutral'
  if (ma50 != null && ma200 != null) {
    if (ma50 > ma200) signal = 'bullish_crossover'
    else if (ma50 < ma200) signal = 'bearish_crossover'
  }
  return { signal, ma50, ma200 }
}

function extractCloses(pricesPayload) {
  const out = []
  const arr = pricesPayload?.prices
  if (!Array.isArray(arr)) return out
  for (const p of arr) {
    // IG returns bid/ask separately; midpoint is the simplest deterministic
    // close for educational MA computation.
    const bid = p?.closePrice?.bid
    const ask = p?.closePrice?.ask
    if (typeof bid === 'number' && typeof ask === 'number') {
      out.push((bid + ask) / 2)
    } else if (typeof bid === 'number') {
      out.push(bid)
    } else if (typeof ask === 'number') {
      out.push(ask)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// State + polling. The poll is driven by the presence of SSE clients - when
// no UI is attached we sleep, which keeps the IG quota footprint tiny.
const state = {
  lastError: null,
  lastUpdatedAt: null,
  accounts: [],
  positions: [],
  signals: [], // [{ epic, signal, ma50, ma200, asOf }]
}

const sseClients = new Set()
let pollTimer = null

function broadcastSnapshot() {
  const payload = JSON.stringify(buildSnapshot())
  const frame = `event: snapshot\ndata: ${payload}\n\n`
  for (const res of sseClients) {
    try { res.write(frame) } catch {}
  }
}

function buildSnapshot() {
  return {
    demo_only: true,
    disclaimer: 'Research/education only. Not financial advice. Demo account.',
    last_updated_at: state.lastUpdatedAt,
    last_error: state.lastError,
    accounts: state.accounts,
    positions: state.positions,
    signals: state.signals,
  }
}

async function pollOnce() {
  try {
    const [accountsResp, positionsResp] = await Promise.all([
      fetchAccounts(),
      fetchPositions(),
    ])
    state.accounts = (accountsResp?.accounts || []).map(a => ({
      accountId: a.accountId,
      accountName: a.accountName,
      accountType: a.accountType,
      currency: a.currency,
      balance: a.balance?.balance ?? null,
      available: a.balance?.available ?? null,
      profitLoss: a.balance?.profitLoss ?? null,
    }))
    state.positions = (positionsResp?.positions || []).map(p => ({
      dealId: p.position?.dealId,
      epic: p.market?.epic,
      instrument: p.market?.instrumentName,
      direction: p.position?.direction,
      size: p.position?.size,
      openLevel: p.position?.openLevel,
      bid: p.market?.bid,
      offer: p.market?.offer,
      currency: p.position?.currency,
      createdDate: p.position?.createdDateUTC,
    }))

    const epics = readWatchlist()
    const signals = []
    for (const epic of epics) {
      try {
        const pricesPayload = await fetchPrices(epic)
        const closes = extractCloses(pricesPayload)
        const { signal, ma50, ma200 } = classifyCrossover(closes)
        signals.push({
          epic, signal, ma50, ma200,
          samples: closes.length,
          asOf: new Date().toISOString(),
        })
      } catch (e) {
        signals.push({ epic, signal: 'error', error: String(e.message || e), asOf: new Date().toISOString() })
      }
    }
    state.signals = signals
    state.lastError = null
    state.lastUpdatedAt = new Date().toISOString()
  } catch (e) {
    state.lastError = String(e.message || e)
    state.lastUpdatedAt = new Date().toISOString()
  }
  broadcastSnapshot()
}

function startPolling() {
  if (pollTimer) return
  pollOnce()
  pollTimer = setInterval(pollOnce, POLL_MS)
}
function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

// ---------------------------------------------------------------------------
// Static file serving. Restricted to PUBLIC_DIR; path is normalised + the
// final realpath must remain inside PUBLIC_DIR.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath
  // Strip any ../ before path.join - defence in depth on top of the realpath check.
  rel = rel.replace(/\\/g, '/').replace(/\.\.+/g, '')
  const abs = path.normalize(path.join(PUBLIC_DIR, rel))
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('forbidden'); return
  }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    const ext = path.extname(abs).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

function injectTheme(html) {
  return html.replace('{{COLOR_ACCENT}}', THEME_ACCENT)
}

// ---------------------------------------------------------------------------
// HTTP routing. GET-only. There are deliberately NO order-placement endpoints
// in this module. Any future contributor: do not add POST /api/order*.
const server = http.createServer((req, res) => {
  // Allow only safe methods. Anything mutating is rejected at the door.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD' })
    res.end('method not allowed')
    return
  }
  let url
  try { url = new URL(req.url, `http://${req.headers.host}`) }
  catch { res.writeHead(400); res.end('bad request'); return }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, demo_only: true, time: new Date().toISOString() }))
    return
  }

  if (url.pathname === '/api/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(buildSnapshot()))
    return
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    })
    res.write(`event: snapshot\ndata: ${JSON.stringify(buildSnapshot())}\n\n`)
    sseClients.add(res)
    startPolling()
    req.on('close', () => {
      sseClients.delete(res)
      if (sseClients.size === 0) stopPolling()
    })
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('index missing'); return }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(injectTheme(html))
    })
    return
  }

  if (url.pathname.startsWith('/public/') || /^\/(app\.js|style\.css)$/.test(url.pathname)) {
    serveStatic(req, res, url.pathname.replace(/^\/public/, ''))
    return
  }

  res.writeHead(404); res.end('not found')
})

server.listen(PORT, BIND, () => {
  console.log(`[trading-research] DEMO-ONLY. Not financial advice.`)
  console.log(`[trading-research] listening on http://${BIND}:${PORT}`)
  console.log(`[trading-research] watchlist: ${WATCHLIST_PATH}`)
})

function shutdown() {
  stopPolling()
  for (const r of sseClients) { try { r.end() } catch {} }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
