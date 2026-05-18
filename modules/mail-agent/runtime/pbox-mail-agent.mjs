#!/usr/bin/env node
/**
 * pbox-mail-agent -- Per-tenant mail task agent (multi-provider).
 *
 * Contract: docs/architecture/v0.5-multi-tenant.md
 *
 * Polls `${INSTALL_PATH}/${COMPANY_SLUG}/store/jobs.db` for APPROVED jobs with
 * task_type='mail' and executes them via `@anthropic-ai/claude-agent-sdk`.
 *
 * Providers (env-driven):
 *   - GOOGLE_CLIENT_ID set  -> Gmail via googleapis MCP surface
 *   - MS365_CLIENT_ID  set  -> Microsoft Graph via @softeria/ms-365-mcp-server
 *   - both set              -> the one whose token cache under
 *                              `${INSTALL_PATH}/${COMPANY_SLUG}/store/{google-auth,ms365-auth}/`
 *                              was modified most recently
 *   - neither               -> idle, warn once every 5 min
 *
 * Hard guards (enforced inside canUseTool, before the SDK invokes a tool):
 *   - BLOCKED_TOOLS: destructive ops are rejected unconditionally
 *   - EMAIL_SEND_TOOLS: recipient domain must be in the per-tenant
 *     `${INSTALL_PATH}/${COMPANY_SLUG}/store/email-allowlist.txt`
 *   - SECRET_PATTERNS: outbound body is scanned, hit = reject
 *   - INJECTION_PATTERNS: outbound body scanned for prompt-injection echoes
 *   - TOOL_RETRY_CAP: same tool can be called at most 10 times per job
 *
 * No external network calls beyond the SDK + the configured MCP servers.
 * No relative paths; all IO uses absolute paths derived from env.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { DatabaseSync } from 'node:sqlite'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import dotenv from 'dotenv'

// ── Env + paths ──────────────────────────────────────────────────────────────

const COMPANY_SLUG  = process.env.COMPANY_SLUG
const INSTALL_PATH  = process.env.INSTALL_PATH
const TASK_TYPE     = process.env.TASK_TYPE || 'mail'

if (!COMPANY_SLUG || !INSTALL_PATH) {
  console.error('[pbox-mail-agent] FATAL: COMPANY_SLUG and INSTALL_PATH env vars are required.')
  process.exit(2)
}

const TENANT_ROOT       = path.join(INSTALL_PATH, COMPANY_SLUG)
const TENANT_ENV_FILE   = path.join(TENANT_ROOT, '.env')
const SETTINGS_PATH     = path.join(TENANT_ROOT, '.claude', 'settings.json')
const JOBS_DB           = path.join(TENANT_ROOT, 'store', 'jobs.db')
const ALLOWLIST_FILE    = path.join(TENANT_ROOT, 'store', 'email-allowlist.txt')
const GOOGLE_AUTH_DIR   = path.join(TENANT_ROOT, 'store', 'google-auth')
const MS365_AUTH_DIR    = path.join(TENANT_ROOT, 'store', 'ms365-auth')
const LOGS_DIR          = path.join(TENANT_ROOT, 'logs')
const AUDIT_LOG         = path.join(LOGS_DIR, 'audit.log')

// Best-effort: ensure logs dir exists (idempotent).
try { mkdirSync(LOGS_DIR, { recursive: true }) } catch {}

// Load the tenant .env on top of whatever the LaunchDaemon injected. Tenant
// .env wins so operator edits take effect on restart.
if (existsSync(TENANT_ENV_FILE)) {
  dotenv.config({ path: TENANT_ENV_FILE, override: true })
}

const AGENT_NAME    = `${COMPANY_SLUG}-${TASK_TYPE}`
const POLL_MS       = Number(process.env.JOB_POLL_MS) > 0 ? Number(process.env.JOB_POLL_MS) : 30_000
const HEARTBEAT_MS  = 15_000
const TOOL_RETRY_CAP = 10
const MAX_BUDGET_USD = Number(process.env.MAX_BUDGET_USD) > 0 ? Number(process.env.MAX_BUDGET_USD) : 5
const MAX_TURNS      = Number(process.env.MAX_TURNS) > 0 ? Number(process.env.MAX_TURNS) : 100
const ALERT_WEBHOOK  = process.env.ALERT_WEBHOOK_URL || null
const NO_PROVIDER_WARN_MS = 5 * 60 * 1000

// ── Provider detection ───────────────────────────────────────────────────────

function detectProvider() {
  const hasGoogle = !!process.env.GOOGLE_CLIENT_ID
  const hasMs365  = !!process.env.MS365_CLIENT_ID
  if (hasGoogle && !hasMs365) return 'google'
  if (hasMs365 && !hasGoogle) return 'ms365'
  if (!hasGoogle && !hasMs365) return null
  // Both set: tiebreak on token-cache mtime.
  const gM = safeMtime(GOOGLE_AUTH_DIR)
  const mM = safeMtime(MS365_AUTH_DIR)
  if (gM == null && mM == null) return 'ms365' // neither authenticated yet; arbitrary default
  if (gM == null) return 'ms365'
  if (mM == null) return 'google'
  return gM >= mM ? 'google' : 'ms365'
}

function safeMtime(p) {
  try {
    const s = statSync(p)
    let latest = s.mtimeMs
    if (s.isDirectory()) {
      for (const f of readdirSync(p)) {
        try {
          const fs2 = statSync(path.join(p, f))
          if (fs2.mtimeMs > latest) latest = fs2.mtimeMs
        } catch {}
      }
    }
    return latest
  } catch { return null }
}

// ── MCP servers (per-tenant, from .claude/settings.json) ─────────────────────

function loadMcpServers() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
    return s.mcpServers ?? {}
  } catch { return {} }
}

// ── Clear Claude SDK session cache between jobs ──────────────────────────────

function clearProjectSessions() {
  try {
    const home = process.env.HOME ?? ''
    if (!home) return
    const encoded = path.join(INSTALL_PATH, `${COMPANY_SLUG}-${TASK_TYPE}`).replace(/\//g, '-')
    const dir = path.join(home, '.claude', 'projects', encoded)
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.jsonl')) {
        try { unlinkSync(path.join(dir, f)) } catch {}
      }
    }
  } catch { /* no sessions / no dir -- fine */ }
}

// ── Email allowlist (operator-edited, one domain per line) ───────────────────

let _allowlistCache = { mtime: 0, domains: [] }

function loadAllowedDomains() {
  try {
    const st = statSync(ALLOWLIST_FILE)
    if (st.mtimeMs === _allowlistCache.mtime) return _allowlistCache.domains
    const raw = readFileSync(ALLOWLIST_FILE, 'utf-8')
    const domains = raw.split(/\r?\n/)
      .map(l => l.trim().toLowerCase())
      .filter(l => l && !l.startsWith('#'))
    _allowlistCache = { mtime: st.mtimeMs, domains }
    return domains
  } catch { return _allowlistCache.domains }
}

function extractEmails(input) {
  return (JSON.stringify(input).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [])
    .map(e => e.toLowerCase())
}

function isAllowedDomain(email) {
  const domain = email.split('@')[1] ?? ''
  const list = loadAllowedDomains()
  if (list.length === 0) return false // fail-closed: empty allowlist = nothing sends
  return list.some(d => domain === d || domain.endsWith('.' + d))
}

// ── Provider-aware tool sets ─────────────────────────────────────────────────
//
// Names follow each MCP server's conventions:
//   Google:  mcp__gmail__*   (e.g. gmail_send, send_message)
//   MS365:   mcp__ms365__*   (e.g. send-mail, reply-mail-message)
// Patterns are deliberately broad: any tool whose name suggests destructive
// behaviour or outbound email is gated through canUseTool.

const BLOCKED_TOOL_PATTERNS = [
  // Calendar mutations (mail agent has no calendar scope)
  /mcp__(ms365|gmail|google)__.*(create|update|delete).*calendar/i,
  /mcp__(ms365|gmail|google)__.*(create|update|delete).*event/i,
  // File mutations (mail agent has no files scope)
  /mcp__(ms365|gmail|google)__.*(upload|delete).*file/i,
  /mcp__(ms365|gmail|google)__.*drive.*(delete|trash|upload)/i,
  // Mailbox-destructive
  /mcp__(ms365|gmail|google)__.*delete.*(message|mail|thread)/i,
  /mcp__(ms365|gmail|google)__.*(empty|purge).*(trash|bin|deleted)/i,
  // Local-write tools (the SDK's built-ins) -- forbidden inside the agent
  /^Write$/, /^Edit$/, /^MultiEdit$/, /^Bash$/, /^NotebookEdit$/,
]

const EMAIL_SEND_PATTERNS = [
  // MS365 / Outlook surface
  /^mcp__ms365__send-?mail$/i,
  /^mcp__ms365__reply-?(all-)?mail-?message$/i,
  /^mcp__ms365__forward-?mail-?message$/i,
  /^mcp__ms365__send-?draft-?message$/i,
  /^mcp__ms365__send-?shared-?mailbox-?mail$/i,
  // Gmail surface (covers both common naming styles)
  /^mcp__(gmail|google)__send(_|-)?message$/i,
  /^mcp__(gmail|google)__send(_|-)?mail$/i,
  /^mcp__(gmail|google)__reply(_|-)?message$/i,
  /^mcp__(gmail|google)__forward(_|-)?message$/i,
]

const ATTACHMENT_READ_PATTERNS = [
  /^mcp__ms365__get-?mail-?attachment$/i,
  /^mcp__ms365__list-?mail-?attachments$/i,
  /^mcp__(gmail|google)__get(_|-)?attachment$/i,
]

function matchesAny(name, patterns) {
  for (const p of patterns) if (p.test(name)) return true
  return false
}

// ── Secret scan ──────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /sk-ant-api[A-Za-z0-9_\-]{10,}/,
  /sk-ant-[A-Za-z0-9_\-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_\-]{35}/,
  /ya29\.[0-9A-Za-z_\-]{20,}/,
  /ghp_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{80,}/,
  /xox[abp]-[0-9]+-[0-9]+-[A-Za-z0-9\-]+/,
  /sk_live_[A-Za-z0-9]{24,}/,
  /Bearer\s+[A-Za-z0-9._\-]{20,}/i,
  /-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+|DSA\s+)?PRIVATE KEY-----/,
  /[A-Z][A-Z0-9_]*_API_KEY\s*[:=]\s*\S+/,
  /[A-Z][A-Z0-9_]*_SECRET\s*[:=]\s*\S+/,
  /\bpassword\s*[:=]\s*[^\s,'"`)]{6,}/i,
]

function scanForSecrets(text) {
  if (!text) return null
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) return re.source.slice(0, 48)
  }
  return null
}

// ── Injection pattern detection (incoming mail + outgoing echo) ──────────────

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(a\s+)?/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /new\s+instructions?:/i,
  /system\s+prompt/i,
  /jailbreak/i,
  /\[INST\]/,
  /<\|system\|>/,
  /override\s+(all\s+)?instructions?/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(all\s+)?previous/i,
  // Multilingual
  /ignorez?\s+(toutes?\s+les?\s+)?instructions?/i,
  /ignora\s+(todas?\s+las?\s+)?instrucciones?/i,
  /ignoriere\s+(alle\s+)?anweisungen/i,
  /игнорируй/i,
  /忽略[\s\S]{0,10}[指令指示提示]/,
  /すべて[\s\S]{0,10}[指示命令]を無視/,
  /تجاهل[\s\S]{0,20}التعليمات/,
  /이전[\s\S]{0,10}지시[\s\S]{0,10}무시/,
  // Role / mode bypass
  /\btrue\s+self\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bmaintenance\s+mode\b/i,
  /\bdan\s+mode\b/i,
  /restrictions?\s+(are\s+)?(lifted|removed|suspended|void)/i,
  /without\s+restrictions?/i,
  /from\s+now\s+on\s+(you\s+)?(will|are|must)/i,
  /your\s+new\s+(role|instructions?|persona|identity)\s+(is|are)/i,
  // Context manipulation
  /SYSTEM\s+UPDATE\s+(RECEIVED|APPLIED|COMPLETE)/i,
  /all\s+previous\s+instructions?\s+are\s+(now\s+)?void/i,
]

function scanForInjection(text) {
  if (!text) return null
  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) return p.source.slice(0, 60)
  }
  const b64Tokens = text.match(/[A-Za-z0-9+/]{40,}={0,2}/g) || []
  for (const tok of b64Tokens) {
    try {
      const decoded = Buffer.from(tok, 'base64').toString('utf8')
      if (/^[\x20-\x7e\n\r\t]{20,}/.test(decoded)) {
        for (const p of INJECTION_PATTERNS) {
          if (p.test(decoded)) return 'base64:' + p.source.slice(0, 50)
        }
      }
    } catch {}
  }
  return null
}

// ── Logging + alerting ───────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [${AGENT_NAME}] ${msg}`)
}

function auditWrite(event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: AGENT_NAME,
    slug: COMPANY_SLUG,
    task_type: TASK_TYPE,
    ...event,
  }) + '\n'
  try { appendFileSync(AUDIT_LOG, line) } catch {}
}

async function alertWebhook(text) {
  if (!ALERT_WEBHOOK) return
  try {
    await fetch(ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, agent: AGENT_NAME, slug: COMPANY_SLUG }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {}
}

// ── canUseTool factory ───────────────────────────────────────────────────────

const _runToolCalls = new Map()        // jobId -> Map<toolName, count>
const _attachmentTaintedJobs = new Set()

function buildCanUseTool(jobId) {
  return function canUseTool(toolName, input) {
    // Retry cap
    if (!_runToolCalls.has(jobId)) _runToolCalls.set(jobId, new Map())
    const counts = _runToolCalls.get(jobId)
    const callCount = (counts.get(toolName) ?? 0) + 1
    counts.set(toolName, callCount)
    if (callCount > TOOL_RETRY_CAP) {
      auditWrite({ event: 'retry_cap_hit', tool: toolName, count: callCount, job_id: jobId })
      alertWebhook(`retry cap hit: ${toolName} ${callCount}x in job ${jobId.slice(0, 8)}`)
      return {
        behavior: 'deny',
        message: `Tool ${toolName} called ${callCount} times this run -- retry cap (${TOOL_RETRY_CAP}) hit. Probable loop.`,
        interrupt: true,
      }
    }

    // Blocked tools (destructive / out-of-scope)
    if (matchesAny(toolName, BLOCKED_TOOL_PATTERNS)) {
      auditWrite({ event: 'tool_denied', tool: toolName, reason: 'out_of_scope' })
      return {
        behavior: 'deny',
        message: `${AGENT_NAME}: tool ${toolName} is outside mail scope -- blocked.`,
        interrupt: true,
      }
    }

    // Attachment read: mark job as tainted (downstream send-after-read = warn)
    if (matchesAny(toolName, ATTACHMENT_READ_PATTERNS)) {
      _attachmentTaintedJobs.add(jobId)
      auditWrite({ event: 'attachment_read', tool: toolName, job_id: jobId })
    }

    // Outbound send: domain allowlist + secret + injection scan
    if (matchesAny(toolName, EMAIL_SEND_PATTERNS)) {
      const recipients = extractEmails(input)
      if (recipients.length === 0) {
        auditWrite({ event: 'tool_denied', tool: toolName, reason: 'no_recipient_found' })
        return {
          behavior: 'deny',
          message: 'No recipient address parsed from send call -- blocked.',
          interrupt: true,
        }
      }
      const blocked = recipients.filter(e => !isAllowedDomain(e))
      if (blocked.length > 0) {
        auditWrite({
          event: 'tool_denied',
          tool: toolName,
          reason: 'email_domain_blocked',
          detail: blocked.join(','),
        })
        return {
          behavior: 'deny',
          message: `Email domain blocked: ${blocked.join(', ')} not in tenant allowlist (${ALLOWLIST_FILE}).`,
          interrupt: true,
        }
      }
      const body = JSON.stringify(input)
      const secret = scanForSecrets(body)
      if (secret) {
        auditWrite({ event: 'tool_denied', tool: toolName, reason: 'secret_detected', pattern: secret })
        return {
          behavior: 'deny',
          message: 'Secret pattern detected in outbound email body -- send blocked.',
          interrupt: true,
        }
      }
      const injection = scanForInjection(body)
      if (injection) {
        auditWrite({ event: 'tool_denied', tool: toolName, reason: 'injection_in_outbound', pattern: injection })
        alertWebhook(`injection in outbound email blocked (job ${jobId.slice(0, 8)})`)
        return {
          behavior: 'deny',
          message: `Injection pattern detected in outbound email -- send blocked. Pattern: ${injection}`,
          interrupt: true,
        }
      }
      if (_attachmentTaintedJobs.has(jobId)) {
        auditWrite({
          event: 'security_warn',
          tool: toolName,
          reason: 'send_after_attachment_read',
          job_id: jobId,
        })
      }
    }

    return { behavior: 'allow' }
  }
}

// ── Error classification ─────────────────────────────────────────────────────

function classifyError(msg) {
  const s = (msg ?? '').toLowerCase()
  if (/abort|econnreset|etimedout|econnrefused|timed out|timeout/.test(s)) return 'timeout'
  if (/429|rate.?limit|too many requests/.test(s)) return 'rate_limited'
  if (/401|403|authentication|unauthorized|forbidden|re-?auth/.test(s)) return 'auth_failed'
  if (/budget cap exceeded/.test(s)) return 'budget_exceeded'
  return 'unknown'
}

// ── Job execution ────────────────────────────────────────────────────────────

async function executeJob(job) {
  const provider = detectProvider()
  if (!provider) {
    log(`Job ${job.id} found but no provider configured -- skipping.`)
    auditWrite({ event: 'job_skipped', job_id: job.id, reason: 'no_provider' })
    return
  }

  const startedAt = Date.now()
  let db
  let heartbeat
  let costUsd = null

  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare('UPDATE jobs SET status=?, updated_at=?, last_active=? WHERE id=?')
      .run('IN_PROGRESS', startedAt, startedAt, job.id)
    db.prepare(
      'INSERT INTO job_events (id,job_id,event_type,actor,detail,created_at) VALUES (?,?,?,?,?,?)'
    ).run(randomUUID(), job.id, 'started', AGENT_NAME, JSON.stringify({ provider }), startedAt)
    db.close()
    db = null

    heartbeat = setInterval(() => {
      try {
        const h = new DatabaseSync(JOBS_DB)
        h.prepare('PRAGMA busy_timeout=5000').run()
        h.prepare('UPDATE jobs SET last_active=? WHERE id=?').run(Date.now(), job.id)
        h.close()
      } catch {}
    }, HEARTBEAT_MS)

    log(`Executing job ${job.id} (provider=${provider})`)
    auditWrite({ event: 'job_started', job_id: job.id, provider })

    // Pre-scan the incoming prompt for injection attempts (advisory only --
    // we still execute, but we flag it. Many legit emails forwarded by an
    // operator will quote injection-shaped text.)
    const injectionInPrompt = scanForInjection(job.prompt)
    if (injectionInPrompt) {
      auditWrite({
        event: 'injection_in_prompt',
        job_id: job.id,
        pattern: injectionInPrompt,
      })
    }

    const env = { ...process.env }
    delete env.CLAUDECODE
    clearProjectSessions()

    const mcpServers = loadMcpServers()
    const cwd = path.join(INSTALL_PATH, `${COMPANY_SLUG}-${TASK_TYPE}`)

    const stream = query({
      prompt: `[Approved job from queue -- job ID: ${job.id} -- tenant: ${COMPANY_SLUG} -- provider: ${provider}]\n\n${job.prompt}`,
      options: {
        cwd,
        settingSources: ['project'],
        mcpServers,
        permissionMode: 'bypassPermissions',
        continue: false,
        persistSession: false,
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: MAX_BUDGET_USD,
        maxTurns: MAX_TURNS,
        env,
        canUseTool: buildCanUseTool(job.id),
      },
    })

    let result = null
    let streamedText = ''

    for await (const ev of stream) {
      if (ev.type === 'tool_use') {
        auditWrite({ event: 'tool_span', job_id: job.id, tool_name: ev.name })
      }
      if (ev.type === 'text' && ev.text) streamedText += ev.text
      if (ev.type === 'result' && ev.subtype === 'success') {
        result = ev.result
        costUsd = ev.total_cost_usd ?? null
        if (result && !result.includes('{') && streamedText.includes('{')) {
          const fi = streamedText.lastIndexOf('{')
          const li = streamedText.lastIndexOf('}')
          if (fi >= 0 && li > fi) {
            result = streamedText.slice(fi, li + 1)
            log(`JSON rescued from streamed text (${result.length} chars)`)
          }
        }
      }
      if (ev.type === 'result' && ev.subtype === 'error_max_budget_usd') {
        costUsd = ev.total_cost_usd ?? null
        const m = `BUDGET KILL: job ${job.id.slice(0, 8)} hit $${MAX_BUDGET_USD} cap (spent: $${(costUsd ?? 0).toFixed(4)}).`
        log(m)
        auditWrite({ event: 'budget_kill', job_id: job.id, cost_usd: costUsd })
        await alertWebhook(m)
        throw new Error(`Budget cap exceeded ($${(costUsd ?? 0).toFixed(4)} / $${MAX_BUDGET_USD.toFixed(2)})`)
      }
      if (ev.type === 'result' && ev.subtype === 'error_during_generation') {
        costUsd = ev.total_cost_usd ?? null
        log(`[sdk error_event] ${JSON.stringify(ev)}`)
      }
    }

    const doneAt = Date.now()
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare(
      'UPDATE jobs SET status=?, result=?, cost_usd=?, updated_at=?, completed_at=? WHERE id=?'
    ).run('COMPLETED', result, costUsd, doneAt, doneAt, job.id)
    db.prepare(
      'INSERT INTO job_events (id,job_id,event_type,actor,detail,created_at) VALUES (?,?,?,?,?,?)'
    ).run(
      randomUUID(),
      job.id,
      'completed',
      AGENT_NAME,
      result?.slice(0, 500) ?? null,
      doneAt,
    )

    log(`Job ${job.id} completed (cost=$${(costUsd ?? 0).toFixed(4)})`)
    auditWrite({ event: 'job_completed', job_id: job.id, cost_usd: costUsd })
  } catch (err) {
    const code = classifyError(err.message)
    log(`Job ${job.id} failed [${code}]: ${err.message}`)
    auditWrite({ event: 'job_failed', job_id: job.id, error: err.message, error_code: code })
    try {
      if (!db) db = new DatabaseSync(JOBS_DB)
      const t = Date.now()
      db.prepare(
        'UPDATE jobs SET status=?, result=?, cost_usd=?, updated_at=? WHERE id=?'
      ).run('FAILED', err.message, costUsd, t, job.id)
      db.prepare(
        'INSERT INTO job_events (id,job_id,event_type,actor,detail,created_at) VALUES (?,?,?,?,?,?)'
      ).run(randomUUID(), job.id, 'failed', AGENT_NAME, err.message, t)
    } catch {}
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    try { db?.close() } catch {}
  }
}

// ── Poll loop ────────────────────────────────────────────────────────────────

let _running = false
let _lastNoProviderWarn = 0

async function poll() {
  // Provider check: warn at most every NO_PROVIDER_WARN_MS, never crash.
  if (!detectProvider()) {
    const now = Date.now()
    if (now - _lastNoProviderWarn >= NO_PROVIDER_WARN_MS) {
      log('no provider configured (GOOGLE_CLIENT_ID / MS365_CLIENT_ID both unset) -- waiting.')
      auditWrite({ event: 'no_provider', detail: 'GOOGLE_CLIENT_ID and MS365_CLIENT_ID both unset' })
      _lastNoProviderWarn = now
    }
    return
  }

  if (!existsSync(JOBS_DB)) return

  let db
  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()

    // Recover abandoned IN_PROGRESS jobs (stale heartbeat > 60s).
    const staleCut = Date.now() - 60_000
    const stale = db.prepare(
      "SELECT id FROM jobs WHERE task_type=? AND status='IN_PROGRESS' AND (last_active IS NULL OR last_active < ?)"
    ).all(TASK_TYPE, staleCut)
    for (const j of stale) {
      db.prepare("UPDATE jobs SET status='APPROVED', last_active=NULL, updated_at=? WHERE id=?")
        .run(Date.now(), j.id)
      log(`Recovered stale IN_PROGRESS job ${j.id} -> APPROVED`)
      auditWrite({ event: 'stale_job_recovered', job_id: j.id })
    }

    const jobs = db.prepare(
      "SELECT * FROM jobs WHERE task_type=? AND status='APPROVED' ORDER BY created_at ASC LIMIT 5"
    ).all(TASK_TYPE)
    db.close()
    db = null

    for (const job of jobs) {
      if (_running) break
      _running = true
      try { await executeJob(job) } finally { _running = false }
    }
  } catch (e) {
    log(`Poll error: ${e.message}`)
  } finally {
    try { db?.close() } catch {}
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

log(`Starting -- slug=${COMPANY_SLUG} task=${TASK_TYPE} poll=${POLL_MS}ms`)
const bootProvider = detectProvider()
log(`Provider at boot: ${bootProvider ?? 'NONE'}`)
auditWrite({ event: 'agent_started', provider: bootProvider, poll_ms: POLL_MS })

// Idempotent schema migrations (older deployments may pre-date these columns).
// Matches files-agent's defensive boot pattern.
if (existsSync(JOBS_DB)) {
  for (const stmt of [
    'ALTER TABLE jobs ADD COLUMN last_active INTEGER',
    'ALTER TABLE jobs ADD COLUMN cost_usd REAL',
    "ALTER TABLE jobs ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'standard'",
  ]) {
    let mdb
    try {
      mdb = new DatabaseSync(JOBS_DB)
      mdb.prepare('PRAGMA busy_timeout=5000').run()
      mdb.prepare(stmt).run()
    } catch { /* column exists */ } finally { mdb?.close() }
  }
}

// Graceful shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`Received ${sig} -- exiting.`)
    auditWrite({ event: 'agent_stopped', signal: sig })
    process.exit(0)
  })
}

poll()
setInterval(poll, POLL_MS)
