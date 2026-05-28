#!/usr/bin/env node
// pbox-personal-ai.mjs -- Personal AI assistant server.
// Localhost-first chat UI with PBKDF2 passphrase auth, SQLite memory,
// Anthropic SDK proxy. Optional Tailscale-IP allowlist and ElevenLabs TTS.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, execFile } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.PERSONAL_AI_PORT || '8800', 10)
const BIND = process.env.PERSONAL_AI_BIND || '127.0.0.1'
const PASS_HASH = process.env.PERSONAL_AI_PASSPHRASE_HASH || ''
const MODEL = process.env.PERSONAL_AI_MODEL || 'claude-sonnet-4-6'
const VOICE_ENABLED = process.env.PERSONAL_AI_VOICE === '1'
const TAILSCALE_ONLY = process.env.PERSONAL_AI_TAILSCALE_ONLY === '1'
const SESSION_TTL_MS = 1000 * 60 * 60 * 8
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || ''
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
const MODULE_HOME = path.join(INSTALL_PATH, 'personal-ai')
const STORE_DIR = path.join(MODULE_HOME, 'store')
const SESSIONS_DIR = path.join(STORE_DIR, 'sessions')
const PUBLIC_DIR = fs.existsSync(path.join(MODULE_HOME, 'public'))
  ? path.join(MODULE_HOME, 'public')
  : path.join(__dirname, 'public')
const DB_PATH = path.join(STORE_DIR, 'memory.db')
const MAX_BODY = 2 * 1024 * 1024
const TAILSCALE_CIDRS = [
  { net: '100.64.0.0', bits: 10, v: 4 },
  { net: 'fd7a:115c:a1e0::', bits: 48, v: 6 },
]

function readTheme() {
  const out = {
    SYSTEM_NAME: 'Pandoras Box',
    PERSONAL_AI_NAME: process.env.PERSONAL_AI_NAME || 'Assistant',
    COLOR_ACCENT: '#00b4ff',
    COLOR_BACKGROUND: '#0d1117',
    COLOR_TEXT: '#c9d1d9',
    AVATAR_GIF: '',
  }
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    for (const line of conf.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?([^"'\n]*)["']?$/)
      if (m && m[1] in out) out[m[1]] = m[2].replace(/\$\{INSTALL_PATH\}/g, INSTALL_PATH)
    }
  } catch {}
  if (process.env.PERSONAL_AI_NAME) out.PERSONAL_AI_NAME = process.env.PERSONAL_AI_NAME
  return out
}
const THEME = readTheme()

fs.mkdirSync(STORE_DIR, { recursive: true })
fs.mkdirSync(SESSIONS_DIR, { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    started_at INTEGER NOT NULL,
    last_msg_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    rating INTEGER,
    regenerated INTEGER DEFAULT 0,
    corrected INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
  CREATE TABLE IF NOT EXISTS important_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    source_message_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS drops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    content_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`)

const sessions = new Map()

function hashPbkdf2(plain, salt) {
  return crypto.pbkdf2Sync(plain, salt, 200000, 32, 'sha256').toString('hex')
}
function verifyPassphrase(plain) {
  if (!PASS_HASH || !plain) return false
  const [salt, hash] = PASS_HASH.split(':')
  if (!salt || !hash) return false
  const a = Buffer.from(hashPbkdf2(plain, salt), 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
function newSession() {
  const token = crypto.randomBytes(32).toString('hex')
  const csrf = crypto.randomBytes(24).toString('hex')
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS, csrf })
  return { token, csrf }
}
function getSession(req) {
  const cookie = req.headers.cookie || ''
  const m = cookie.match(/pai_sess=([a-f0-9]+)/)
  if (!m) return null
  const s = sessions.get(m[1])
  if (!s || s.expires < Date.now()) { sessions.delete(m[1]); return null }
  return { token: m[1], ...s }
}
function getCsrfCookie(req) {
  const cookie = req.headers.cookie || ''
  const m = cookie.match(/pai_csrf=([a-f0-9]+)/)
  return m ? m[1] : null
}
function csrfOk(req, sess) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const cookie = getCsrfCookie(req)
  const header = req.headers['x-csrf-token']
  if (!cookie || !header || !sess) return false
  if (cookie !== sess.csrf || header !== sess.csrf) return false
  return true
}

function getApiKey() {
  try {
    const out = execFileSync('security',
      ['find-generic-password', '-a', process.env.USER || 'pbox', '-s', 'pbox-anthropic-key', '-w'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (out) return out
  } catch {}
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const home = process.env.HOME || ''
    if (home) {
      const credPath = path.join(home, '.config', 'claude', 'credentials.json')
      if (fs.existsSync(credPath)) {
        const j = JSON.parse(fs.readFileSync(credPath, 'utf8'))
        if (j && typeof j.api_key === 'string') return j.api_key
      }
    }
  } catch {}
  return null
}

function parseIp4(s) {
  const m = s.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return (parseInt(m[1]) << 24 >>> 0) + (parseInt(m[2]) << 16) + (parseInt(m[3]) << 8) + parseInt(m[4])
}
function inCidr4(ip, cidr) {
  const ipN = parseIp4(ip); const baseN = parseIp4(cidr.net)
  if (ipN == null || baseN == null) return false
  const mask = cidr.bits === 0 ? 0 : (~0 << (32 - cidr.bits)) >>> 0
  return (ipN & mask) === (baseN & mask)
}
function ipAllowed(req) {
  if (!TAILSCALE_ONLY) return true
  const ip = req.socket.remoteAddress || ''
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true
  for (const c of TAILSCALE_CIDRS) {
    if (c.v === 4 && inCidr4(ip, c)) return true
    if (c.v === 6 && ip.toLowerCase().startsWith(c.net.toLowerCase().split('::')[0])) return true
  }
  return false
}

function ensureConversation(id, firstUserContent) {
  if (id) {
    const row = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
    if (row) return row.id
  }
  const now = Date.now()
  const title = (firstUserContent || 'New conversation').slice(0, 80).replace(/\s+/g, ' ').trim()
  const r = db.prepare('INSERT INTO conversations (title, started_at, last_msg_at) VALUES (?, ?, ?)')
    .run(title, now, now)
  return Number(r.lastInsertRowid)
}
function recordMessage(conversation_id, role, content) {
  const now = Date.now()
  const r = db.prepare(
    'INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(conversation_id, role, content, now)
  db.prepare('UPDATE conversations SET last_msg_at = ? WHERE id = ?').run(now, conversation_id)
  appendSessionLog({ ts: now, conversation_id, role, content })
  return Number(r.lastInsertRowid)
}
function appendSessionLog(entry) {
  try {
    const d = new Date(entry.ts || Date.now())
    const fname = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}.jsonl`
    fs.appendFileSync(path.join(SESSIONS_DIR, fname), JSON.stringify(entry) + '\n')
  } catch {}
}
function loadHistory(conversation_id, limit = 40) {
  const rows = db.prepare(
    'SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
  ).all(conversation_id, limit)
  return rows.reverse()
}
function loadImportantFacts() {
  const rows = db.prepare('SELECT fact FROM important_facts ORDER BY id DESC LIMIT 100').all()
  return rows.map(r => r.fact)
}

// Semantic recall from the vector-kb module (localhost, best-effort). If the
// module is not installed/reachable, recall is simply empty. _VECTOR_RECALL_V1
const VECTOR_KB_URL = (process.env.VECTOR_KB_URL || 'http://127.0.0.1:8486').replace(/\/$/, '')
async function recallMemories(query) {
  if (!query) return []
  try {
    const r = await fetch(`${VECTOR_KB_URL}/search?q=${encodeURIComponent(String(query).slice(0, 500))}&k=5`,
      { signal: AbortSignal.timeout(2500) })
    if (!r.ok) return []
    const j = await r.json()
    return (j.results || []).filter(x => x.score > 0.3).map(x => x.text)
  } catch { return [] }
}

let AnthropicCtor = null
async function getAnthropic() {
  if (AnthropicCtor) return AnthropicCtor
  const mod = await import('@anthropic-ai/sdk')
  AnthropicCtor = mod.default || mod.Anthropic
  return AnthropicCtor
}

function buildSystemPrompt(recalled = []) {
  const facts = loadImportantFacts()
  const factsBlock = facts.length
    ? '\n\nUser facts pinned as important:\n' + facts.map(f => '- ' + f).join('\n')
    : ''
  const recallBlock = recalled.length
    ? '\n\nRelevant memories (semantic recall):\n' + recalled.map(f => '- ' + f).join('\n')
    : ''
  return `You are ${THEME.PERSONAL_AI_NAME}, a personal AI assistant running on the operator's machine. ` +
    `Be concise, accurate, and useful. Avoid filler. Never invent facts about the operator -- ` +
    `if you do not know, say so.${factsBlock}${recallBlock}`
}

// CLI bridge: with no API key, reason through the `claude` CLI using the operator's
// subscription auth (the CLI reads $HOME/.claude). No per-token billing, no key on
// disk. This path is plain chat (no tool-use), so the conversation is rendered into a
// single prompt. _CLI_BRIDGE_V1
const CLAUDE_BIN = process.env.PBOX_CLAUDE_BIN || 'claude'
async function callClaudeViaCLI({ history, userContent }) {
  let recalled = []
  try { recalled = await recallMemories(userContent) } catch {}
  const system = buildSystemPrompt(recalled)
  const lines = []
  for (const m of history) {
    if (m.role === 'user') lines.push(`User: ${m.content}`)
    else if (m.role === 'assistant') lines.push(`Assistant: ${m.content}`)
  }
  lines.push(`User: ${userContent}`)
  const prompt = lines.join('\n\n')
  const args = ['-p', '--model', MODEL, '--append-system-prompt', system, '--output-format', 'json']
  return await new Promise((resolve, reject) => {
    const child = execFile(CLAUDE_BIN, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude CLI bridge failed: ${String(stderr || err.message).slice(0, 300)}`))
      let text = ''
      try {
        const j = JSON.parse(stdout)
        if (j && j.is_error) return reject(new Error(`claude CLI error: ${String(j.result || j.subtype || 'unknown').slice(0, 300)}`))
        text = (j && (j.result || j.text)) || ''
      } catch { text = String(stdout).trim() }
      if (!text) return reject(new Error('claude CLI bridge returned empty output'))
      resolve(text)
    })
    try { child.stdin.write(prompt); child.stdin.end() } catch (e) { reject(e) }
  })
}

async function callClaude({ history, userContent, stream = false }) {
  const apiKey = getApiKey()
  if (!apiKey) {
    // Subscription / CLI bridge path (returns full text; no token stream).
    return await callClaudeViaCLI({ history, userContent })
  }
  const Ctor = await getAnthropic()
  const client = new Ctor({ apiKey })
  const messages = []
  for (const m of history) {
    if (m.role === 'user' || m.role === 'assistant') messages.push({ role: m.role, content: m.content })
  }
  messages.push({ role: 'user', content: userContent })
  const recalled = await recallMemories(userContent)
  const opts = {
    model: MODEL,
    max_tokens: 2048,
    system: buildSystemPrompt(recalled),
    messages,
  }
  if (stream) return client.messages.stream(opts)
  const resp = await client.messages.create(opts)
  return (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
async function readJson(req) {
  const raw = await readBody(req)
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { throw new Error('invalid json') }
}
function setCookie(res, parts) {
  const prev = res.getHeader('set-cookie')
  const arr = Array.isArray(prev) ? prev : (prev ? [prev] : [])
  arr.push(parts.join('; '))
  res.setHeader('set-cookie', arr)
}
function clearCookie(res, name) {
  setCookie(res, [`${name}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'])
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}
function readPublicFile(name) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safe || safe.startsWith('.')) return null
  const full = path.join(PUBLIC_DIR, safe)
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return null
  try {
    const data = fs.readFileSync(full)
    return { data, type: STATIC_TYPES[path.extname(full)] || 'application/octet-stream' }
  } catch { return null }
}

const DEFAULT_AVATAR_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${THEME.COLOR_ACCENT}"/><stop offset="1" stop-color="${THEME.COLOR_BACKGROUND}"/>
  </linearGradient></defs>
  <circle cx="48" cy="48" r="46" fill="url(#g)"/>
  <text x="48" y="58" font-family="-apple-system, sans-serif" font-size="34" font-weight="600" text-anchor="middle" fill="${THEME.COLOR_TEXT}">${escapeHtml((THEME.PERSONAL_AI_NAME || 'A').charAt(0).toUpperCase())}</text>
</svg>`

function serveAvatar(res) {
  const candidate = THEME.AVATAR_GIF
  if (candidate && fs.existsSync(candidate)) {
    try {
      const data = fs.readFileSync(candidate)
      res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'public, max-age=300' })
      res.end(data); return
    } catch {}
  }
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300' })
  res.end(DEFAULT_AVATAR_SVG)
}

function renderLoginPage(error = '') {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(THEME.PERSONAL_AI_NAME)} -- sign in</title>
<style>
  :root { --accent:${THEME.COLOR_ACCENT}; --bg:${THEME.COLOR_BACKGROUND}; --fg:${THEME.COLOR_TEXT}; }
  body { font-family:-apple-system,BlinkMacSystemFont,sans-serif; background:var(--bg); color:var(--fg); margin:0; display:flex; align-items:center; justify-content:center; height:100vh; }
  form { background:rgba(255,255,255,0.04); padding:32px; border-radius:10px; width:320px; box-shadow:0 4px 24px rgba(0,0,0,0.4); }
  h1 { margin:0 0 4px; font-size:1.3rem; }
  .sub { color:#888; font-size:0.85rem; margin-bottom:20px; }
  input { width:100%; padding:12px; background:var(--bg); border:1px solid #2a2a40; border-radius:6px; color:var(--fg); box-sizing:border-box; font-size:14px; }
  button { margin-top:14px; width:100%; padding:12px; background:var(--accent); border:none; border-radius:6px; color:#000; font-weight:600; cursor:pointer; font-size:14px; }
  .err { color:#ff6b6b; font-size:13px; margin-top:10px; }
</style></head>
<body><form method="POST" action="/api/login" enctype="application/x-www-form-urlencoded">
  <h1>${escapeHtml(THEME.PERSONAL_AI_NAME)}</h1>
  <div class="sub">${escapeHtml(THEME.SYSTEM_NAME)} -- Personal AI</div>
  <input name="passphrase" type="password" placeholder="Passphrase" autofocus required autocomplete="current-password">
  <button type="submit">Sign in</button>
  ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
</form></body></html>`
}

function renderApp() {
  let html
  const file = readPublicFile('index.html')
  if (file) html = file.data.toString('utf8')
  else html = '<!doctype html><html><body>index.html missing in public/</body></html>'
  html = html
    .replaceAll('{{PERSONAL_AI_NAME}}', escapeHtml(THEME.PERSONAL_AI_NAME))
    .replaceAll('{{SYSTEM_NAME}}', escapeHtml(THEME.SYSTEM_NAME))
    .replaceAll('{{COLOR_ACCENT}}', THEME.COLOR_ACCENT)
    .replaceAll('{{COLOR_BACKGROUND}}', THEME.COLOR_BACKGROUND)
    .replaceAll('{{COLOR_TEXT}}', THEME.COLOR_TEXT)
    .replaceAll('{{VOICE_ENABLED}}', VOICE_ENABLED ? '1' : '0')
    .replaceAll('{{TTS_ENABLED}}', ELEVENLABS_KEY ? '1' : '0')
  return html
}

async function handleLogin(req, res) {
  const raw = await readBody(req)
  let passphrase = ''
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try { passphrase = JSON.parse(raw).passphrase || '' } catch {}
  } else {
    const m = raw.match(/(?:^|&)passphrase=([^&]*)/)
    if (m) passphrase = decodeURIComponent(m[1].replace(/\+/g, ' '))
  }
  if (!verifyPassphrase(passphrase)) {
    if ((req.headers.accept || '').includes('application/json')) {
      send(res, 401, { error: 'invalid passphrase' }); return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(renderLoginPage('Wrong passphrase.')); return
  }
  const { token, csrf } = newSession()
  const secure = req.socket && req.socket.encrypted ? '; Secure' : ''
  res.writeHead(302, {
    'set-cookie': [
      `pai_sess=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS/1000}${secure}`,
      `pai_csrf=${csrf}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS/1000}${secure}`,
    ],
    location: '/',
  })
  res.end()
}

function handleLogout(req, res) {
  const s = getSession(req)
  if (s) sessions.delete(s.token)
  clearCookie(res, 'pai_sess'); clearCookie(res, 'pai_csrf')
  send(res, 200, { ok: true })
}

async function handleChat(req, res) {
  const body = await readJson(req)
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return send(res, 400, { error: 'content required' })
  const cidIn = body.conversation_id != null ? parseInt(body.conversation_id, 10) : null
  const cid = ensureConversation(Number.isInteger(cidIn) && cidIn > 0 ? cidIn : null, content)
  recordMessage(cid, 'user', content)
  const history = loadHistory(cid).slice(0, -1)
  try {
    const text = await callClaude({ history, userContent: content, stream: false })
    const mid = recordMessage(cid, 'assistant', text)
    send(res, 200, { conversation_id: cid, message_id: mid, content: text })
  } catch (e) {
    send(res, 502, { error: 'llm_error', detail: String(e.message || e) })
  }
}

async function handleChatStream(req, res, url) {
  const cidIn = url.searchParams.get('conversation_id')
  const content = (url.searchParams.get('content') || '').trim()
  if (!content) return send(res, 400, { error: 'content required' })
  const cidNum = cidIn ? parseInt(cidIn, 10) : null
  const cid = ensureConversation(Number.isInteger(cidNum) && cidNum > 0 ? cidNum : null, content)
  recordMessage(cid, 'user', content)
  const history = loadHistory(cid).slice(0, -1)
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(`event: start\ndata: ${JSON.stringify({ conversation_id: cid })}\n\n`)

  // Bridge mode (no API key): the CLI path returns the full reply, not a token
  // stream. Emit it as a single SSE token, then end. _CLI_BRIDGE_V1
  if (!getApiKey()) {
    try {
      const text = await callClaude({ history, userContent: content, stream: false })
      res.write(`event: token\ndata: ${JSON.stringify({ text })}\n\n`)
      const mid = recordMessage(cid, 'assistant', text)
      res.write(`event: end\ndata: ${JSON.stringify({ message_id: mid })}\n\n`)
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(e.message || e) })}\n\n`)
    }
    return res.end()
  }

  let acc = ''
  try {
    const stream = await callClaude({ history, userContent: content, stream: true })
    stream.on('text', (chunk) => {
      acc += chunk
      res.write(`event: token\ndata: ${JSON.stringify({ text: chunk })}\n\n`)
    })
    stream.on('error', (err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err.message || err) })}\n\n`)
      res.end()
    })
    await stream.finalMessage()
    const mid = recordMessage(cid, 'assistant', acc)
    res.write(`event: end\ndata: ${JSON.stringify({ message_id: mid })}\n\n`)
    res.end()
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: String(e.message || e) })}\n\n`)
    res.end()
  }
}

function handleListConversations(req, res) {
  const rows = db.prepare(
    'SELECT id, title, started_at, last_msg_at FROM conversations ORDER BY last_msg_at DESC LIMIT 200'
  ).all()
  send(res, 200, { conversations: rows })
}

function handleListMessages(req, res, idStr) {
  const id = parseInt(idStr, 10)
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: 'bad id' })
  const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
  if (!exists) return send(res, 404, { error: 'not found' })
  const rows = db.prepare(
    'SELECT id, role, content, created_at, rating, regenerated, corrected FROM messages WHERE conversation_id = ? ORDER BY id ASC'
  ).all(id)
  send(res, 200, { conversation_id: id, messages: rows })
}

async function handleAddFact(req, res) {
  const body = await readJson(req)
  const fact = typeof body.fact === 'string' ? body.fact.trim() : ''
  if (!fact) return send(res, 400, { error: 'fact required' })
  if (fact.length > 1000) return send(res, 400, { error: 'fact too long' })
  let srcId = null
  if (body.source_message_id != null) {
    const sid = parseInt(body.source_message_id, 10)
    if (Number.isInteger(sid) && sid > 0) {
      const exists = db.prepare('SELECT id FROM messages WHERE id = ?').get(sid)
      if (exists) srcId = sid
    }
  }
  const r = db.prepare(
    'INSERT INTO important_facts (fact, created_at, source_message_id) VALUES (?, ?, ?)'
  ).run(fact, Date.now(), srcId)
  send(res, 200, { id: Number(r.lastInsertRowid) })
}

function handleListFacts(req, res) {
  const rows = db.prepare(
    'SELECT id, fact, created_at, source_message_id FROM important_facts ORDER BY id DESC LIMIT 500'
  ).all()
  send(res, 200, { facts: rows })
}

const ALLOWED_DROP_KINDS = new Set(['note', 'link', 'file', 'image', 'snippet'])
async function handleAddDrop(req, res) {
  const body = await readJson(req)
  const kind = typeof body.kind === 'string' ? body.kind.trim() : ''
  const contentPath = typeof body.content_path === 'string' ? body.content_path.trim() : ''
  if (!ALLOWED_DROP_KINDS.has(kind)) return send(res, 400, { error: 'invalid kind' })
  if (!contentPath || contentPath.length > 1024) return send(res, 400, { error: 'invalid content_path' })
  if (contentPath.includes('\0') || contentPath.includes('..')) return send(res, 400, { error: 'invalid content_path' })
  const r = db.prepare(
    'INSERT INTO drops (kind, content_path, created_at) VALUES (?, ?, ?)'
  ).run(kind, contentPath, Date.now())
  send(res, 200, { id: Number(r.lastInsertRowid) })
}

function handleListDrops(req, res) {
  const rows = db.prepare(
    'SELECT id, kind, content_path, created_at FROM drops ORDER BY id DESC LIMIT 200'
  ).all()
  send(res, 200, { drops: rows })
}

async function handleTts(req, res) {
  if (!ELEVENLABS_KEY) return send(res, 404, { error: 'tts disabled' })
  const body = await readJson(req)
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text || text.length > 5000) return send(res, 400, { error: 'invalid text' })
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'content-type': 'application/json',
        'accept': 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' }),
    })
    if (!r.ok) {
      const err = await r.text()
      return send(res, 502, { error: 'tts_failed', status: r.status, detail: err.slice(0, 500) })
    }
    const buf = Buffer.from(await r.arrayBuffer())
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': buf.length })
    res.end(buf)
  } catch (e) {
    send(res, 502, { error: 'tts_failed', detail: String(e.message || e) })
  }
}

function handleHealth(req, res) {
  send(res, 200, {
    ok: true,
    version: 'v0.4',
    model: MODEL,
    voice_enabled: VOICE_ENABLED,
    tts_enabled: !!ELEVENLABS_KEY,
    name: THEME.PERSONAL_AI_NAME,
  })
}

async function handleRateMessage(req, res, idStr) {
  const body = await readJson(req)
  const id = parseInt(idStr, 10)
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: 'bad id' })
  const rating = parseInt(body.rating, 10)
  if (![-1, 0, 1].includes(rating)) return send(res, 400, { error: 'rating must be -1, 0, or 1' })
  const r = db.prepare('UPDATE messages SET rating = ? WHERE id = ?').run(rating, id)
  if (r.changes === 0) return send(res, 404, { error: 'not found' })
  send(res, 200, { ok: true })
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ipAllowed(req)) return send(res, 403, { error: 'forbidden' })
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const p = url.pathname

    if (p === '/avatar.gif' && req.method === 'GET') return serveAvatar(res)

    if (p === '/' && req.method === 'GET') {
      const sess = getSession(req)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(sess ? renderApp() : renderLoginPage())
      return
    }
    if (p.startsWith('/public/') && req.method === 'GET') {
      const file = readPublicFile(p.slice('/public/'.length))
      if (!file) return send(res, 404, { error: 'not found' })
      res.writeHead(200, { 'content-type': file.type, 'cache-control': 'public, max-age=60' })
      return res.end(file.data)
    }

    if (p === '/api/login' && req.method === 'POST') return handleLogin(req, res)
    if (p === '/api/health' && req.method === 'GET') return handleHealth(req, res)

    const sess = getSession(req)
    if (!sess) return send(res, 401, { error: 'unauthorized' })
    if (!csrfOk(req, sess)) return send(res, 403, { error: 'csrf' })

    if (p === '/api/logout' && req.method === 'POST') return handleLogout(req, res)
    if (p === '/api/chat' && req.method === 'POST') return handleChat(req, res)
    if (p === '/api/chat/stream' && req.method === 'GET') return handleChatStream(req, res, url)
    if (p === '/api/conversations' && req.method === 'GET') return handleListConversations(req, res)
    const mMsgs = p.match(/^\/api\/conversations\/(\d+)\/messages$/)
    if (mMsgs && req.method === 'GET') return handleListMessages(req, res, mMsgs[1])
    if (p === '/api/important_facts' && req.method === 'POST') return handleAddFact(req, res)
    if (p === '/api/important_facts' && req.method === 'GET')  return handleListFacts(req, res)
    if (p === '/api/drops' && req.method === 'POST') return handleAddDrop(req, res)
    if (p === '/api/drops' && req.method === 'GET')  return handleListDrops(req, res)
    if (p === '/api/tts' && req.method === 'POST') return handleTts(req, res)
    const mRate = p.match(/^\/api\/messages\/(\d+)\/rate$/)
    if (mRate && req.method === 'POST') return handleRateMessage(req, res, mRate[1])

    send(res, 404, { error: 'not found' })
  } catch (e) {
    try { send(res, 500, { error: 'server_error', detail: String(e.message || e) }) } catch {}
  }
})

server.on('listening', () => {
  console.log(`[personal-ai] listening on http://${BIND}:${PORT}`)
  console.log(`[personal-ai] model: ${MODEL}`)
  if (!PASS_HASH) console.log('[personal-ai] WARNING: PERSONAL_AI_PASSPHRASE_HASH not set; login disabled')
  if (TAILSCALE_ONLY) console.log('[personal-ai] Tailscale-only allowlist active')
})

server.listen(PORT, BIND)

function shutdown() {
  try { db.close() } catch {}
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
