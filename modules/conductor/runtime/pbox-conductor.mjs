#!/usr/bin/env node
// pbox-conductor.mjs -- per-tenant orchestration daemon for Pandora's Box (v0.5).
//
// One conductor instance runs per company slug. It is tenant-agnostic: all
// company-specific paths, identifiers, and credentials are read from the
// per-tenant `<slug>/.env` file at startup. The conductor never holds provider
// credentials directly -- those belong to the task agents.
//
// Architecture (see docs/architecture/v0.5-multi-tenant.md for the pinned contract):
//   1. Load relay driver based on RELAY_TYPE env (discord / slack / whatsapp /
//      browser-default localhost HTTP).
//   2. Receive inbound message -> classify task_type via a small Claude call ->
//      insert a row into <slug>/store/jobs.db with status=PENDING_REVIEW.
//   3. If a content-classifier sidecar is installed it will flip the row to
//      APPROVED or REJECTED. If not installed, the conductor auto-approves so
//      single-operator deployments still work.
//   4. Poll the same DB for COMPLETED jobs and deliver the `result` back via
//      the relay driver. Mark delivery in `job_events`.
//   5. Per-conversation chat memory persists to <slug>/store/conversations.db.
//   6. Heartbeat: write Date.now() to a .pid file every 15s.
//   7. Graceful SIGTERM/SIGINT closes DBs, flushes audit log, disconnects relay.

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import { query } from '@anthropic-ai/claude-agent-sdk'

// -- Env + paths -------------------------------------------------------------

const COMPANY_SLUG        = process.env.COMPANY_SLUG
const INSTALL_PATH        = process.env.INSTALL_PATH
const LAUNCHDAEMON_PREFIX = process.env.LAUNCHDAEMON_PREFIX

function die (msg) {
  process.stderr.write(`[pbox-conductor] FATAL: ${msg}\n`)
  process.exit(1)
}

if (!COMPANY_SLUG)        die('COMPANY_SLUG env not set')
if (!INSTALL_PATH)        die('INSTALL_PATH env not set')
if (!LAUNCHDAEMON_PREFIX) die('LAUNCHDAEMON_PREFIX env not set')

const TENANT_DIR    = path.join(INSTALL_PATH, COMPANY_SLUG)
const ENV_FILE      = path.join(TENANT_DIR, '.env')
const STORE_DIR     = path.join(TENANT_DIR, 'store')
const LOGS_DIR      = path.join(TENANT_DIR, 'logs')
const JOBS_DB_PATH  = path.join(STORE_DIR, 'jobs.db')
const CONVOS_DB     = path.join(STORE_DIR, 'conversations.db')
const AUDIT_LOG     = path.join(LOGS_DIR, 'audit.log')
const PID_FILE      = path.join(STORE_DIR, 'conductor.pid')

// dotenv loads <slug>/.env into process.env without overwriting existing keys.
if (existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE })

const RELAY_TYPE       = (process.env.RELAY_TYPE || '').trim().toLowerCase()
const ANTHROPIC_MODEL  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
const CONDUCTOR_PORT   = parseInt(process.env.CONDUCTOR_HTTP_PORT || '8181', 10)
const CONDUCTOR_BIND   = process.env.CONDUCTOR_HTTP_BIND || '127.0.0.1'
const JOB_POLL_MS      = parseInt(process.env.JOB_POLL_MS || '3000', 10)
const HEARTBEAT_MS     = parseInt(process.env.HEARTBEAT_MS || '15000', 10)
const AGENT_DISPLAY    = process.env.AGENT_DISPLAY_NAME || COMPANY_SLUG

// _ACTIVATION_MATRIX_V1 -- enforce per-agent activation from shared/agent-activation.json.
// Keyed by AGENT_ACTIVATION_KEY (default COMPANY_SLUG). Absent file/entry => allow all.
const AGENT_KEY = process.env.AGENT_ACTIVATION_KEY || COMPANY_SLUG
const TASKTYPE_MODULE = { mail: 'mail', calendar: 'calendar', files: 'files', voice: 'voice-agent' }
let ACTIVATION = null
function loadActivation () {
  try {
    const all = JSON.parse(readFileSync(path.join(INSTALL_PATH, 'shared', 'agent-activation.json'), 'utf8'))
    const entry = all[AGENT_KEY]
    if (entry && Array.isArray(entry.modules_active)) {
      ACTIVATION = entry
      log('info', 'activation matrix loaded', { agent: AGENT_KEY, modules_active: entry.modules_active })
    } else {
      log('info', 'activation matrix: no entry for this agent; allowing all', { agent: AGENT_KEY })
    }
  } catch { log('info', 'activation matrix: none present; allowing all') }
}
function moduleActive (taskType) {
  if (!ACTIVATION) return true                 // no matrix -> allow all (back-compat)
  const mod = TASKTYPE_MODULE[taskType]
  if (!mod) return true                        // non-task types (general) are not module-gated
  return ACTIVATION.modules_active.includes(mod)
}

if (!process.env.ANTHROPIC_API_KEY) {
  // Allowed: SDK may fall back to macOS Keychain. Warn only.
  process.stderr.write('[pbox-conductor] WARN: ANTHROPIC_API_KEY not in env -- relying on Keychain.\n')
}

// -- Logger ------------------------------------------------------------------

function log (level, msg, data = {}) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    svc: `${COMPANY_SLUG}-conductor`,
    msg,
    ...data,
  })
  process.stdout.write(entry + '\n')
}

// -- Filesystem prep ---------------------------------------------------------

for (const d of [STORE_DIR, LOGS_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

// -- Audit log writer --------------------------------------------------------

function auditWrite (event) {
  try {
    const entry = JSON.stringify({
      ts:     new Date().toISOString(),
      source: 'conductor',
      slug:   COMPANY_SLUG,
      ...event,
    }) + '\n'
    appendFileSync(AUDIT_LOG, entry, { mode: 0o600 })
  } catch (err) {
    log('warn', 'audit-log write failed', { error: err.message })
  }
}

// -- Jobs DB -----------------------------------------------------------------

const jobsDb = new DatabaseSync(JOBS_DB_PATH)
jobsDb.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    task_type       TEXT NOT NULL
                    CHECK (task_type IN ('mail', 'calendar', 'files', 'voice')),
    prompt          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                    CHECK (status IN (
                      'PENDING_REVIEW','APPROVED','REJECTED','IN_PROGRESS',
                      'COMPLETED','FAILED','BLOCKED'
                    )),
    risk_level      TEXT NOT NULL DEFAULT 'standard'
                    CHECK (risk_level IN ('standard', 'high')),
    conductor_ref   TEXT,
    result          TEXT,
    reviewer_note   TEXT,
    cost_usd        REAL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    completed_at    INTEGER,
    last_active     INTEGER
  );

  CREATE TABLE IF NOT EXISTS job_events (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    actor       TEXT NOT NULL,
    detail      TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status_type ON jobs(status, task_type);
  CREATE INDEX IF NOT EXISTS idx_jobs_conductor_ref ON jobs(conductor_ref);
  CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
`)
jobsDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')

// Track whether a content-classifier review layer is installed. We treat the
// absence of any PENDING_REVIEW -> APPROVED/REJECTED transition by anything
// other than the conductor itself as "no reviewer present"; for now we use a
// simple env switch so the conductor does not need to introspect installs.
const CONTENT_CLASSIFIER_INSTALLED =
  (process.env.CONTENT_CLASSIFIER_INSTALLED || '').toLowerCase() === 'true'

function insertJob ({ taskType, prompt, conductorRef, riskLevel = 'standard' }) {
  const id  = crypto.randomUUID()
  const now = Date.now()
  jobsDb.prepare(`
    INSERT INTO jobs
      (id, task_type, prompt, status, risk_level, conductor_ref, created_at, updated_at)
    VALUES (?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?)
  `).run(id, taskType, prompt, riskLevel, conductorRef || null, now, now)

  insertEvent(id, 'created', 'conductor', { taskType, riskLevel, conductorRef })
  return id
}

function insertEvent (jobId, eventType, actor, detail) {
  jobsDb.prepare(`
    INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), jobId, eventType, actor, JSON.stringify(detail || {}), Date.now())
}

function updateJobStatus (id, status, fields = {}) {
  const sets = ['status = ?', 'updated_at = ?']
  const args = [status, Date.now()]
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`)
    args.push(v)
  }
  args.push(id)
  jobsDb.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args)
}

// -- Conversations DB --------------------------------------------------------

const convosDb = new DatabaseSync(CONVOS_DB)
convosDb.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id           TEXT PRIMARY KEY,
    channel_ref  TEXT NOT NULL,
    history      TEXT NOT NULL DEFAULT '[]',
    last_active  INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_ref);
`)
convosDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')

const MAX_HISTORY_TURNS = 20

function loadConversation (channelRef) {
  const row = convosDb.prepare(
    'SELECT id, history FROM conversations WHERE channel_ref = ?'
  ).get(channelRef)
  if (!row) {
    const id = crypto.randomUUID()
    const now = Date.now()
    convosDb.prepare(`
      INSERT INTO conversations (id, channel_ref, history, last_active, created_at)
      VALUES (?, ?, '[]', ?, ?)
    `).run(id, channelRef, now, now)
    return { id, history: [] }
  }
  let history = []
  try { history = JSON.parse(row.history) } catch { history = [] }
  return { id: row.id, history }
}

function appendConversation (channelRef, turn) {
  const c = loadConversation(channelRef)
  const next = [...c.history, turn].slice(-MAX_HISTORY_TURNS)
  convosDb.prepare(
    'UPDATE conversations SET history = ?, last_active = ? WHERE id = ?'
  ).run(JSON.stringify(next), Date.now(), c.id)
}

// -- Task-type classifier (small Claude call -> single word) -----------------

const TASK_TYPES = ['mail', 'calendar', 'files', 'general']

const CLASSIFY_SYSTEM = `You are a message router. Classify the user's message into exactly one of:
- mail: read, send, or reply to email
- calendar: anything about meetings, events, schedule, availability
- files: file/document/spreadsheet operations or database queries
- general: status checks, knowledge questions, or anything that does not need a background task

Reply with ONE WORD ONLY: mail, calendar, files, or general.`

async function classifyTaskType (text) {
  if (!text || text.trim().length < 2) return 'general'

  try {
    const q = query({
      prompt: text.slice(0, 2000),
      options: {
        model: ANTHROPIC_MODEL,
        systemPrompt: CLASSIFY_SYSTEM,
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
      },
    })
    let final = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        final = String(msg.result || '').trim().toLowerCase()
        break
      }
    }
    final = final.replace(/[^a-z]/g, '')
    return TASK_TYPES.includes(final) ? final : 'general'
  } catch (err) {
    log('warn', 'classifyTaskType failed -- defaulting to general', { error: err.message })
    return 'general'
  }
}

// -- Outbound delivery routing -----------------------------------------------
//
// Relay drivers register a `send(channelRef, text)` callback so the outbound
// poller can route a COMPLETED job's `result` back to wherever the message
// originated.

let activeRelay = null  // { name, send(channelRef, text), shutdown() }

// -- Inbound entry point -----------------------------------------------------
//
// Every relay driver funnels here. `channelRef` uniquely identifies the
// conversation thread (e.g. Discord channel id, Slack thread ts, WhatsApp
// number, browser session id). `messageId` is the relay's per-message id; we
// store `${channelRef}::${messageId}` in `conductor_ref` so outbound delivery
// can find the right reply target.

async function handleInbound ({ channelRef, messageId, text, source }) {
  const cleanText = String(text || '').trim()
  if (!cleanText) return null

  appendConversation(channelRef, { role: 'user', content: cleanText, ts: Date.now() })

  const taskType = await classifyTaskType(cleanText)
  log('info', 'inbound classified', {
    channelRef, source, taskType, preview: cleanText.slice(0, 120),
  })

  const conductorRef = `${channelRef}::${messageId || crypto.randomUUID()}`
  const jobId = insertJob({ taskType, prompt: cleanText, conductorRef })

  auditWrite({
    event: 'inbound_message',
    relay: source,
    channelRef,
    jobId,
    taskType,
    bytes: cleanText.length,
  })

  // Activation-matrix gate: reject task-types whose module is not active for this agent.
  if (!moduleActive(taskType)) {
    const mod = TASKTYPE_MODULE[taskType]
    updateJobStatus(jobId, 'REJECTED', { reviewer_note: `module '${mod}' not active for this agent (activation matrix)` })
    insertEvent(jobId, 'reviewed', 'activation-matrix', { decision: 'rejected', reason: 'module-not-active', module: mod })
    auditWrite({ event: 'activation_blocked', jobId, taskType, module: mod })
    return { jobId, taskType, conductorRef, blocked: true }
  }

  if (!CONTENT_CLASSIFIER_INSTALLED) {
    // Auto-approve: single-operator deployment with no review layer.
    updateJobStatus(jobId, 'APPROVED', { reviewer_note: 'auto-approved (no content-classifier installed)' })
    insertEvent(jobId, 'reviewed', 'conductor', { decision: 'auto-approved' })
  }

  return { jobId, taskType, conductorRef }
}

// -- Outbound poller ---------------------------------------------------------
//
// Every JOB_POLL_MS, find COMPLETED jobs that have not been delivered yet and
// hand the result to the active relay driver. We mark delivery by inserting a
// `delivered` row into `job_events`; a job is "delivered" iff such a row exists.

const DELIVERED_EVENT = 'delivered'

function findUndeliveredCompletedJobs () {
  return jobsDb.prepare(`
    SELECT j.*
    FROM jobs j
    LEFT JOIN job_events e
      ON e.job_id = j.id AND e.event_type = '${DELIVERED_EVENT}'
    WHERE j.status IN ('COMPLETED', 'FAILED')
      AND j.conductor_ref IS NOT NULL
      AND e.id IS NULL
    ORDER BY j.completed_at IS NULL, j.completed_at ASC, j.updated_at ASC
    LIMIT 25
  `).all()
}

function parseConductorRef (ref) {
  if (!ref) return null
  const idx = ref.indexOf('::')
  if (idx < 0) return { channelRef: ref, messageId: null }
  return { channelRef: ref.slice(0, idx), messageId: ref.slice(idx + 2) }
}

async function deliverPendingResults () {
  if (!activeRelay) return
  const jobs = findUndeliveredCompletedJobs()
  for (const job of jobs) {
    const parsed = parseConductorRef(job.conductor_ref)
    if (!parsed) {
      insertEvent(job.id, DELIVERED_EVENT, 'conductor',
        { skipped: 'no conductor_ref' })
      continue
    }
    const body = job.status === 'FAILED'
      ? `Task failed: ${job.result || '(no error detail returned)'}`
      : (job.result || '(no result returned)')

    try {
      await activeRelay.send(parsed.channelRef, body)
      insertEvent(job.id, DELIVERED_EVENT, 'conductor', { relay: activeRelay.name })
      appendConversation(parsed.channelRef, {
        role: 'assistant', content: body, ts: Date.now(), jobId: job.id,
      })
      auditWrite({
        event: 'outbound_message',
        relay: activeRelay.name,
        channelRef: parsed.channelRef,
        jobId: job.id,
        bytes: body.length,
        status: job.status,
      })
    } catch (err) {
      log('warn', 'relay send failed', { jobId: job.id, error: err.message })
      // Do not insert DELIVERED_EVENT -- we will retry on next poll.
    }
  }
}

setInterval(() => { deliverPendingResults().catch(() => {}) }, JOB_POLL_MS)

// -- Relay drivers -----------------------------------------------------------

async function startDiscordRelay () {
  const token = process.env.DISCORD_TOKEN
  const allowChannelId = process.env.DISCORD_CHANNEL_ID
  if (!token) die('RELAY_TYPE=discord but DISCORD_TOKEN not set')

  const { Client, GatewayIntentBits, Partials } = await import('discord.js')
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  })

  client.on('messageCreate', async (msg) => {
    try {
      if (msg.author?.bot) return
      if (allowChannelId && String(msg.channelId) !== String(allowChannelId)) return
      const channelRef = String(msg.channelId)
      await handleInbound({
        channelRef,
        messageId: String(msg.id),
        text: msg.content,
        source: 'discord',
      })
      try { await msg.channel.sendTyping() } catch {}
    } catch (err) {
      log('error', 'discord inbound error', { error: err.message })
    }
  })

  await client.login(token)
  log('info', 'discord relay ready')

  return {
    name: 'discord',
    async send (channelRef, text) {
      const channel = await client.channels.fetch(channelRef)
      // Discord's per-message cap is 2000 chars; chunk politely.
      const MAX = 1900
      let i = 0
      while (i < text.length) {
        await channel.send(text.slice(i, i + MAX))
        i += MAX
      }
    },
    async shutdown () { try { await client.destroy() } catch {} },
  }
}

async function startSlackRelay () {
  const botToken = process.env.SLACK_BOT_TOKEN
  const appToken = process.env.SLACK_APP_TOKEN
  if (!botToken) die('RELAY_TYPE=slack but SLACK_BOT_TOKEN not set')
  if (!appToken) die('RELAY_TYPE=slack but SLACK_APP_TOKEN not set (Socket Mode required)')

  const boltMod = await import('@slack/bolt')
  const App = boltMod.App || boltMod.default?.App
  if (!App) die('@slack/bolt module shape unexpected -- missing App export')

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
    logLevel: 'warn',
  })

  app.message(async ({ message }) => {
    try {
      if (message.subtype || message.bot_id) return
      const channelRef = `${message.channel}/${message.thread_ts || message.ts}`
      await handleInbound({
        channelRef,
        messageId: String(message.ts),
        text: message.text,
        source: 'slack',
      })
    } catch (err) {
      log('error', 'slack inbound error', { error: err.message })
    }
  })

  await app.start()
  log('info', 'slack relay ready')

  return {
    name: 'slack',
    async send (channelRef, text) {
      const sep = channelRef.indexOf('/')
      const channel  = sep > 0 ? channelRef.slice(0, sep) : channelRef
      const threadTs = sep > 0 ? channelRef.slice(sep + 1) : undefined
      await app.client.chat.postMessage({ channel, text, thread_ts: threadTs })
    },
    async shutdown () { try { await app.stop() } catch {} },
  }
}

async function startWhatsappRelay () {
  const bridgeDir = process.env.WHATSAPP_BRIDGE_DIR
    || path.join(STORE_DIR, 'whatsapp-bridge')
  if (!existsSync(bridgeDir)) mkdirSync(bridgeDir, { recursive: true })

  const waMod = await import('whatsapp-web.js')
  const { Client, LocalAuth } = waMod.default ?? waMod
  let qrcode = null
  try {
    const qrMod = await import('qrcode-terminal')
    qrcode = qrMod.default ?? qrMod
  } catch {}

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: bridgeDir, clientId: COMPANY_SLUG }),
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  })

  client.on('qr', (qr) => {
    if (qrcode?.generate) qrcode.generate(qr, { small: true })
    log('info', 'whatsapp QR emitted -- scan from a paired phone')
  })
  client.on('ready', () => log('info', 'whatsapp relay ready'))
  client.on('auth_failure', (m) => log('error', 'whatsapp auth_failure', { detail: String(m).slice(0, 200) }))

  client.on('message', async (msg) => {
    try {
      if (msg.fromMe) return
      const channelRef = msg.from
      await handleInbound({
        channelRef,
        messageId: msg.id?._serialized || crypto.randomUUID(),
        text: msg.body,
        source: 'whatsapp',
      })
    } catch (err) {
      log('error', 'whatsapp inbound error', { error: err.message })
    }
  })

  await client.initialize()

  return {
    name: 'whatsapp',
    async send (channelRef, text) {
      await client.sendMessage(channelRef, text)
    },
    async shutdown () { try { await client.destroy() } catch {} },
  }
}

// Browser-default: simple localhost JSON HTTP server. The operator's chat UI
// (e.g. the admin-lite panel or a custom front-end) POSTs to /message and
// long-polls /pending for the result.

async function startBrowserDefaultRelay () {
  const sessions = new Map()  // channelRef -> { queue: [msg], resolvers: [] }

  function getSession (id) {
    if (!sessions.has(id)) sessions.set(id, { queue: [], resolvers: [] })
    return sessions.get(id)
  }

  function readJson (req, max = 64 * 1024) {
    return new Promise((resolve, reject) => {
      let total = 0
      const chunks = []
      req.on('data', (c) => {
        total += c.length
        if (total > max) {
          reject(new Error('payload too large'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
        catch (e) { reject(e) }
      })
      req.on('error', reject)
    })
  }

  function reply (res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer(async (req, res) => {
    try {
      const remote = req.socket.remoteAddress || ''
      if (!remote.startsWith('127.') && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        return reply(res, 403, { error: 'loopback only' })
      }

      if (req.method === 'POST' && req.url === '/message') {
        const body = await readJson(req)
        const channelRef = String(body.channelRef || body.sessionId || 'default')
        const text = String(body.text || '')
        const r = await handleInbound({
          channelRef,
          messageId: crypto.randomUUID(),
          text,
          source: 'browser',
        })
        return reply(res, 200, { ok: true, jobId: r?.jobId || null, taskType: r?.taskType || null })
      }

      if (req.method === 'GET' && req.url?.startsWith('/pending')) {
        const u = new URL(req.url, 'http://localhost')
        const channelRef = String(u.searchParams.get('channelRef') || 'default')
        const s = getSession(channelRef)
        if (s.queue.length) return reply(res, 200, { messages: s.queue.splice(0, s.queue.length) })
        // Long-poll up to 25s.
        let resolver
        const timeout = setTimeout(() => {
          const i = s.resolvers.indexOf(resolver)
          if (i >= 0) s.resolvers.splice(i, 1)
          reply(res, 200, { messages: [] })
        }, 25_000)
        resolver = () => {
          clearTimeout(timeout)
          reply(res, 200, { messages: s.queue.splice(0, s.queue.length) })
        }
        s.resolvers.push(resolver)
        return
      }

      if (req.method === 'GET' && req.url === '/health') {
        return reply(res, 200, { ok: true, slug: COMPANY_SLUG, relay: 'browser' })
      }

      return reply(res, 404, { error: 'not found' })
    } catch (err) {
      log('warn', 'browser relay request error', { error: err.message })
      try { reply(res, 500, { error: err.message }) } catch {}
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(CONDUCTOR_PORT, CONDUCTOR_BIND, () => resolve())
  })
  log('info', 'browser relay ready', { bind: CONDUCTOR_BIND, port: CONDUCTOR_PORT })

  return {
    name: 'browser',
    async send (channelRef, text) {
      const s = getSession(channelRef)
      s.queue.push({ text, ts: Date.now() })
      const r = s.resolvers.shift()
      if (r) r()
    },
    async shutdown () { await new Promise((resolve) => server.close(() => resolve())) },
  }
}

// Telegram long-poll relay. No SDK -- the Bot API is plain HTTPS. Optional
// TELEGRAM_CHAT_ID restricts the bot to a single chat (recommended).
async function startTelegramRelay () {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) die('RELAY_TYPE=telegram but TELEGRAM_BOT_TOKEN not set')
  const allowChatId = (process.env.TELEGRAM_CHAT_ID || '').trim()
  const API = `https://api.telegram.org/bot${token}`
  let running = true
  let offset = 0

  async function tg (method, body) {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    return r.json()
  }

  async function poll () {
    while (running) {
      try {
        const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(40000) })
        const data = await res.json()
        if (!data.ok) { await new Promise(r => setTimeout(r, 3000)); continue }
        for (const u of data.result || []) {
          offset = u.update_id + 1
          const msg = u.message
          if (!msg || !msg.text) continue
          const chatId = String(msg.chat.id)
          if (allowChatId && chatId !== allowChatId) continue   // auth: only the allowed chat
          try {
            await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
            await handleInbound({ channelRef: `telegram/${chatId}`, messageId: String(msg.message_id), text: msg.text, source: 'telegram' })
          } catch (e) { log('error', 'telegram inbound error', { error: e.message }) }
        }
      } catch (e) {
        if (running) { log('warn', 'telegram poll error', { error: e.message }); await new Promise(r => setTimeout(r, 3000)) }
      }
    }
  }
  poll()
  log('info', 'telegram relay ready', { allowlisted: !!allowChatId })

  return {
    name: 'telegram',
    async send (channelRef, text) {
      const chatId = channelRef.includes('/') ? channelRef.split('/')[1] : channelRef
      const MAX = 4000   // Telegram message cap is 4096
      for (let i = 0; i < text.length; i += MAX) {
        await tg('sendMessage', { chat_id: chatId, text: text.slice(i, i + MAX) })
      }
    },
    async shutdown () { running = false },
  }
}

async function startRelay () {
  switch (RELAY_TYPE) {
    case 'discord':   return startDiscordRelay()
    case 'slack':     return startSlackRelay()
    case 'whatsapp':  return startWhatsappRelay()
    case 'telegram':  return startTelegramRelay()
    case '':
    case 'browser':
    case 'browser-default':
      return startBrowserDefaultRelay()
    default:
      die(`Unknown RELAY_TYPE=${RELAY_TYPE} (expected: discord, slack, whatsapp, telegram, or unset)`)
  }
}

// -- Heartbeat ---------------------------------------------------------------

function writeHeartbeat () {
  try {
    writeFileSync(PID_FILE, JSON.stringify({
      pid: process.pid,
      ts:  Date.now(),
      slug: COMPANY_SLUG,
      relay: activeRelay?.name || null,
    }) + '\n', { mode: 0o600 })
  } catch (err) {
    log('warn', 'heartbeat write failed', { error: err.message })
  }
}

setInterval(writeHeartbeat, HEARTBEAT_MS)

// -- Graceful shutdown -------------------------------------------------------

let shuttingDown = false
async function shutdown (signal) {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutdown begin', { signal })
  try { await activeRelay?.shutdown() } catch (e) { log('warn', 'relay shutdown error', { error: e.message }) }
  try { jobsDb.close() } catch {}
  try { convosDb.close() } catch {}
  auditWrite({ event: 'conductor_stop', signal })
  log('info', 'shutdown done')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('unhandledRejection', (err) => log('error', 'unhandledRejection', { error: String(err) }))
process.on('uncaughtException',  (err) => log('error', 'uncaughtException',  { error: err.message }))

// -- Boot --------------------------------------------------------------------

;(async () => {
  log('info', 'conductor boot', {
    slug: COMPANY_SLUG,
    install_path: INSTALL_PATH,
    relay_type: RELAY_TYPE || 'browser-default',
    model: ANTHROPIC_MODEL,
    content_classifier: CONTENT_CLASSIFIER_INSTALLED,
    label: `${LAUNCHDAEMON_PREFIX}.${COMPANY_SLUG}-conductor`,
  })
  auditWrite({ event: 'conductor_start', relay: RELAY_TYPE || 'browser-default' })
  writeHeartbeat()

  loadActivation()

  try {
    activeRelay = await startRelay()
  } catch (err) {
    log('error', 'relay start failed', { error: err.message })
    process.exit(2)
  }

  log('info', 'conductor ready', { agent: AGENT_DISPLAY })
})()
