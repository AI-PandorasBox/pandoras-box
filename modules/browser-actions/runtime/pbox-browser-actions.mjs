#!/usr/bin/env node
// pbox-browser-actions.mjs -- full interactive browser surface for agents.
// Localhost-only HTTP API backed by a local Playwright Chromium. Every action
// is token-gated, navigation is domain-allowlisted, and everything is audited.
// _BROWSER_ACTIONS_V1
//
//   POST /session                      -> { ok }  (launch browser)
//   POST /navigate   { url }           -> { title, url }   (allowlisted hosts only)
//   POST /read       { selector? }     -> { text }
//   POST /click      { selector }      -> { ok }
//   POST /type       { selector, text, submit? } -> { ok }
//   POST /screenshot { full? }         -> { path }
//   GET  /healthz
//
// Headers: x-pbox-token: <BROWSER_ACTIONS_TOKEN> required on every action.
// Pages are UNTRUSTED: extracted text may contain prompt-injection; the calling
// agent must treat it as data, and Argus/content-classifier should review.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Load this module's .env (token, allowlist) without a dotenv dependency.
try {
  const ep = path.join(path.dirname(new URL(import.meta.url).pathname), '.env')
  for (const line of fs.readFileSync(ep, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const PORT = parseInt(process.env.BROWSER_ACTIONS_PORT || '8483', 10)
const BIND = process.env.BROWSER_ACTIONS_BIND || '127.0.0.1'
const STORE = process.env.BROWSER_ACTIONS_STORE || path.join(process.env.INSTALL_PATH || '/opt/pandoras-box', 'browser-actions', 'store')
const TOKEN = process.env.BROWSER_ACTIONS_TOKEN || ''
// Comma-separated allowed domains. EMPTY = deny all navigation (safe default).
const ALLOWLIST = (process.env.BROWSER_ACTIONS_ALLOWLIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

fs.mkdirSync(STORE, { recursive: true })
const AUDIT = path.join(STORE, 'browser-audit.log')
const audit = (e) => { try { fs.appendFileSync(AUDIT, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n') } catch {} }

let browser = null, page = null
async function ensurePage () {
  if (page) return page
  let chromium
  try { ({ chromium } = await import('playwright')) }
  catch { throw new Error('playwright not installed -- run: bash modules/browser-actions/install.sh') }
  browser = await chromium.launch({ headless: process.env.BROWSER_ACTIONS_HEADLESS !== 'false' })
  page = await browser.newPage()
  return page
}
function hostAllowed (url) {
  let h
  try { h = new URL(url).hostname.toLowerCase() } catch { return false }
  if (ALLOWLIST.length === 0) return false                     // deny-all until configured
  return ALLOWLIST.some(d => h === d || h.endsWith('.' + d))
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
function body (req) { return new Promise((resolve, reject) => { let d = '', n = 0; req.on('data', c => { n += c.length; if (n > 1048576) { reject(new Error('body too large')); req.destroy() } d += c }); req.on('end', () => resolve(d)); req.on('error', reject) }) }

const server = http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`) } catch { return json(res, 400, { error: 'bad url' }) }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    let pw = false; try { await import('playwright'); pw = true } catch {}
    return json(res, 200, { ok: true, playwright: pw, allowlisted_domains: ALLOWLIST.length, token_set: !!TOKEN, browser_open: !!page })
  }

  // every action requires the token
  if (!TOKEN || req.headers['x-pbox-token'] !== TOKEN) { audit({ kind: 'denied_auth', path: url.pathname }); return json(res, 401, { error: 'missing or invalid x-pbox-token' }) }

  try {
    const data = req.method === 'POST' ? JSON.parse(await body(req) || '{}') : {}
    switch (url.pathname) {
      case '/session': { await ensurePage(); audit({ kind: 'session' }); return json(res, 200, { ok: true }) }
      case '/navigate': {
        if (!hostAllowed(data.url)) { audit({ kind: 'navigate_blocked', url: data.url }); return json(res, 403, { error: 'url not in BROWSER_ACTIONS_ALLOWLIST' }) }
        const p = await ensurePage(); await p.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        audit({ kind: 'navigate', url: data.url }); return json(res, 200, { title: await p.title(), url: p.url() })
      }
      case '/read': {
        const p = await ensurePage()
        const text = data.selector ? (await p.locator(data.selector).first().innerText().catch(() => '')) : (await p.evaluate(() => document.body?.innerText || ''))
        audit({ kind: 'read', selector: data.selector || 'body', bytes: text.length }); return json(res, 200, { text: text.slice(0, 100000) })
      }
      case '/click': {
        const p = await ensurePage(); await p.locator(data.selector).first().click({ timeout: 10000 })
        audit({ kind: 'click', selector: data.selector }); return json(res, 200, { ok: true })
      }
      case '/type': {
        const p = await ensurePage(); await p.locator(data.selector).first().fill(String(data.text || ''))
        if (data.submit) await p.keyboard.press('Enter')
        audit({ kind: 'type', selector: data.selector, submit: !!data.submit }); return json(res, 200, { ok: true })
      }
      case '/screenshot': {
        const p = await ensurePage(); const out = path.join(STORE, `shot-${Date.now()}.png`)
        await p.screenshot({ path: out, fullPage: !!data.full }); audit({ kind: 'screenshot', path: out }); return json(res, 200, { path: out })
      }
      default: return json(res, 404, { error: 'not found' })
    }
  } catch (e) { audit({ kind: 'error', path: url.pathname, error: String(e.message || e) }); return json(res, 500, { error: String(e.message || e) }) }
})

server.listen(PORT, BIND, () => {
  console.log(`[browser-actions] listening on http://${BIND}:${PORT} (allowlist: ${ALLOWLIST.length} domains, token ${TOKEN ? 'set' : 'NOT SET -- actions denied'})`)
})
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await browser?.close() } catch {}; process.exit(0) })
