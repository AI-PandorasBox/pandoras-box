#!/usr/bin/env node
/**
 * pbox-calendar-agent -- per-tenant calendar task agent (Pandora's Box v0.5)
 *
 * Tenant-agnostic, multi-provider runtime. Polls the per-tenant jobs.db for
 * APPROVED jobs with task_type='calendar' and executes them via the
 * Claude Agent SDK, using whichever calendar provider (Google or MS365) is
 * configured for the tenant.
 *
 * Provider selection:
 *   - GOOGLE_CLIENT_ID set in env -> Google Calendar via googleapis MCP wiring
 *   - MS365_CLIENT_ID  set in env -> MS Graph via @softeria/ms-365-mcp-server
 *   - Both set                    -> the provider whose token file is more
 *                                    recently touched wins (last-authenticated)
 *   - Neither set                 -> agent stays alive but logs a warning
 *                                    every 5 minutes; no jobs are processed
 *
 * Contract: docs/architecture/v0.5-multi-tenant.md
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { DatabaseSync } from 'node:sqlite'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// ── Env-driven config ─────────────────────────────────────────────────────────

const COMPANY_SLUG  = process.env.COMPANY_SLUG
const INSTALL_PATH  = process.env.INSTALL_PATH
const TASK_TYPE     = process.env.TASK_TYPE ?? 'calendar'

if (!COMPANY_SLUG || !INSTALL_PATH) {
  console.error('[pbox-calendar-agent] FATAL: COMPANY_SLUG and INSTALL_PATH must be set in env')
  process.exit(1)
}

const AGENT_NAME    = `${COMPANY_SLUG}-calendar`
const PROJECT       = `${INSTALL_PATH}/${AGENT_NAME}`
const TENANT_ROOT   = `${INSTALL_PATH}/${COMPANY_SLUG}`
const JOBS_DB       = `${TENANT_ROOT}/store/jobs.db`
const AUDIT_LOG     = `${TENANT_ROOT}/logs/audit.log`
const SETTINGS_JSON = `${PROJECT}/.claude/settings.json`
const GOOGLE_AUTH   = `${TENANT_ROOT}/store/google-auth`
const MS365_AUTH    = `${TENANT_ROOT}/store/ms365-auth`

const POLL_MS         = Number(process.env.JOB_POLL_MS ?? 30_000)
const HEARTBEAT_MS    = 15_000
const TOOL_RETRY_CAP  = 10
const MAX_BUDGET_USD  = Number(process.env.MAX_BUDGET_USD ?? 5)
const MAX_TURNS       = Number(process.env.MAX_TURNS ?? 10)
const NO_PROVIDER_WARN_MS = 5 * 60_000

// Provider detection (re-evaluated every poll so install.sh changes pick up)
function detectProvider () {
  const hasGoogle = !!process.env.GOOGLE_CLIENT_ID
  const hasMs365  = !!process.env.MS365_CLIENT_ID
  if (hasGoogle && hasMs365) {
    // Tie-break: whichever auth dir has the most-recently-modified token file
    const newest = (dir) => {
      try {
        let m = 0
        for (const f of readdirSync(dir)) {
          try { m = Math.max(m, statSync(`${dir}/${f}`).mtimeMs) } catch {}
        }
        return m
      } catch { return 0 }
    }
    return newest(GOOGLE_AUTH) >= newest(MS365_AUTH) ? 'google' : 'ms365'
  }
  if (hasGoogle) return 'google'
  if (hasMs365)  return 'ms365'
  return null
}

// MCP servers from per-tenant settings.json. Tenant-agnostic; operator-edited.
function loadMcpServers () {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
    return s.mcpServers ?? {}
  } catch { return {} }
}

// Clear stored agent-SDK session state so each job is a fresh conversation.
function clearProjectSessions () {
  try {
    const home = process.env.HOME ?? ''
    if (!home) return
    const encoded = PROJECT.replace(/\//g, '-')
    const dir = `${home}/.claude/projects/${encoded}`
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.jsonl')) unlinkSync(`${dir}/${f}`)
    }
  } catch { /* no prior sessions -- fine */ }
}

// ── Provider-aware tool policy ────────────────────────────────────────────────
//
// Calendar mutation rules (see CLAUDE-contract):
//   - personal calendar reads/writes      -> auto-allowed
//   - personal single-attendee creates    -> auto-allowed
//   - group / room / shared mutations     -> route to operator approval (high)
//   - deletions of events with attendees  -> route to operator approval (high)
//
// We cannot fully classify a mutation at the canUseTool boundary because the
// SDK passes tool name + args -- we use a deny-by-default list for high-risk
// tools (group/shared/delete-with-attendees families) and route those calls
// to a sub-job via the jobs DB at status='PENDING_REVIEW', risk_level='high'.

// Pattern-based deny list, multi-provider. Mirrors mail-agent's regex approach
// so both Google + MS365 surfaces are blocked symmetrically. An MS365-only Set
// would leave Gmail / Google Drive mutations unblocked on a Google-calendar
// tenant unless the operator separately edited .claude/settings.json.
const BLOCKED_TOOL_PATTERNS = [
  // generic SDK tools never used by a calendar agent
  /^Write$/, /^Bash$/, /^Edit$/, /^MultiEdit$/, /^NotebookEdit$/,
  // mail send / reply / forward / draft surfaces (any provider)
  /mcp__(ms365|gmail|google)__.*(send|reply|forward|draft).*(mail|message)/i,
  /mcp__(ms365|gmail|google)__.*(empty|purge).*(trash|bin|deleted)/i,
  // files mutations (any provider)
  /mcp__(ms365|gmail|google)__.*(upload|delete).*file/i,
  /mcp__(ms365|gmail|google)__.*drive.*(delete|trash|upload)/i,
]

function isBlockedTool (toolName) {
  return BLOCKED_TOOL_PATTERNS.some(p => p.test(toolName))
}

// Tool-name fragments that trigger the operator-approval routing.
// We check substrings rather than exact names because MCP servers vary.
const HIGH_RISK_FRAGMENTS = [
  'shared-calendar', 'shared_calendar',
  'group-calendar',  'group_calendar',
  'room-calendar',   'room_calendar',
  'delete-event',    'delete_event',
  'cancel-event',    'cancel_event',
]

function isHighRiskTool (toolName, toolArgs) {
  const lower = (toolName ?? '').toLowerCase()
  for (const frag of HIGH_RISK_FRAGMENTS) {
    if (lower.includes(frag)) return true
  }
  // Heuristic for attendee-bearing args (deletion / cancellation paths)
  try {
    if (toolArgs && (lower.includes('delete') || lower.includes('cancel'))) {
      const a = JSON.stringify(toolArgs).toLowerCase()
      if (a.includes('"attendees"') || a.includes('attendee')) return true
    }
  } catch {}
  return false
}

const _runToolCalls = new Map()

function buildCanUseTool (jobId, jobsDbPath) {
  return function canUseTool (toolName, toolArgs) {
    if (!_runToolCalls.has(jobId)) _runToolCalls.set(jobId, new Map())
    const counts = _runToolCalls.get(jobId)
    const count  = (counts.get(toolName) ?? 0) + 1
    counts.set(toolName, count)

    if (count > TOOL_RETRY_CAP) {
      auditWrite({ event: 'retry_cap_hit', tool: toolName, count, job_id: jobId, task_type: TASK_TYPE })
      return {
        behavior: 'deny',
        message:  `Tool ${toolName} called ${count}x in this job. Retry cap (${TOOL_RETRY_CAP}) hit -- possible loop.`,
        interrupt: true,
      }
    }

    if (isBlockedTool(toolName)) {
      auditWrite({ event: 'tool_denied', tool: toolName, reason: 'out_of_scope', job_id: jobId, task_type: TASK_TYPE })
      return { behavior: 'deny', message: `${AGENT_NAME}: ${toolName} is outside calendar scope.`, interrupt: false }
    }

    if (isHighRiskTool(toolName, toolArgs)) {
      // Route to operator approval: insert a PENDING_REVIEW sub-job and deny
      // this call so the agent returns control to the conductor.
      const subId = enqueueHighRiskReview(jobsDbPath, jobId, toolName, toolArgs)
      auditWrite({
        event: 'high_risk_routed', tool: toolName, parent_job: jobId, review_job: subId, task_type: TASK_TYPE,
      })
      return {
        behavior: 'deny',
        message: `${AGENT_NAME}: ${toolName} routed to operator approval (job ${subId}). Return control to conductor.`,
        interrupt: true,
      }
    }

    return { behavior: 'allow' }
  }
}

function enqueueHighRiskReview (jobsDbPath, parentJobId, toolName, toolArgs) {
  const subId = randomUUID()
  const now   = Date.now()
  const prompt = `[High-risk calendar action -- operator approval required]\n\n` +
                 `Parent job: ${parentJobId}\n` +
                 `Tool: ${toolName}\n` +
                 `Args: ${JSON.stringify(toolArgs ?? {}, null, 2)}\n\n` +
                 `Approve or reject to release this action.`
  try {
    const db = new DatabaseSync(jobsDbPath)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare(
      'INSERT INTO jobs (id, task_type, prompt, status, risk_level, conductor_ref, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(subId, TASK_TYPE, prompt, 'PENDING_REVIEW', 'high', `parent:${parentJobId}`, now, now)
    db.prepare(
      'INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), subId, 'created', AGENT_NAME, JSON.stringify({ parent: parentJobId, tool: toolName }), now)
    db.close()
  } catch (e) {
    log(`enqueueHighRiskReview failed: ${e.message}`)
  }
  return subId
}

// ── Logging + audit ──────────────────────────────────────────────────────────

function log (msg) {
  console.log(`[${new Date().toISOString()}] [${AGENT_NAME}] ${msg}`)
}

function auditWrite (event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), source: AGENT_NAME, slug: COMPANY_SLUG, task_type: TASK_TYPE, ...event }) + '\n'
  try {
    if (!existsSync(dirname(AUDIT_LOG))) mkdirSync(dirname(AUDIT_LOG), { recursive: true })
    appendFileSync(AUDIT_LOG, line)
  } catch {}
}

function classifyError (msg) {
  const s = (msg ?? '').toLowerCase()
  if (/abort|econnreset|etimedout|econnrefused|timed out|timeout/.test(s)) return 'timeout'
  if (/429|rate.?limit|too many requests/.test(s)) return 'rate_limited'
  if (/401|403|authentication|re-auth|unauthorized|forbidden/.test(s)) return 'auth_failed'
  if (/budget cap exceeded/.test(s)) return 'budget_exceeded'
  return 'unknown'
}

// ── Job execution ────────────────────────────────────────────────────────────

async function executeJob (job, provider) {
  const startTs = Date.now()
  let db
  let heartbeat
  let costUsd = null

  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare('UPDATE jobs SET status=?, updated_at=?, last_active=? WHERE id=?')
      .run('IN_PROGRESS', startTs, startTs, job.id)
    db.prepare('INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), job.id, 'started', AGENT_NAME, JSON.stringify({ provider }), startTs)
    db.close()
    db = null

    heartbeat = setInterval(() => {
      try {
        const hdb = new DatabaseSync(JOBS_DB)
        hdb.prepare('PRAGMA busy_timeout=5000').run()
        hdb.prepare('UPDATE jobs SET last_active=? WHERE id=?').run(Date.now(), job.id)
        hdb.close()
      } catch {}
    }, HEARTBEAT_MS)

    log(`Executing job ${job.id} (provider=${provider})`)
    auditWrite({ event: 'job_started', job_id: job.id, task_type: TASK_TYPE, provider })

    const env = { ...process.env }
    delete env.CLAUDECODE
    clearProjectSessions()

    let result = null
    let streamed = ''

    const events = query({
      prompt: `[Approved calendar job -- id ${job.id} -- provider ${provider}]\n\n${job.prompt}`,
      options: {
        cwd: PROJECT,
        settingSources: ['project'],
        mcpServers: loadMcpServers(),
        permissionMode: 'bypassPermissions',
        continue: false,
        persistSession: false,
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: MAX_BUDGET_USD,
        maxTurns: MAX_TURNS,
        env,
        canUseTool: buildCanUseTool(job.id, JOBS_DB),
      },
    })

    for await (const ev of events) {
      if (ev.type === 'tool_use') {
        auditWrite({ event: 'tool_span', job_id: job.id, tool_name: ev.name, task_type: TASK_TYPE })
      }
      if (ev.type === 'text' && ev.text) streamed += ev.text
      if (ev.type === 'result' && ev.subtype === 'success') {
        result  = ev.result
        costUsd = ev.total_cost_usd ?? null
        if (result && !result.includes('{') && streamed.includes('{')) {
          const fi = streamed.lastIndexOf('{')
          const li = streamed.lastIndexOf('}')
          if (fi >= 0 && li > fi) result = streamed.slice(fi, li + 1)
        }
      }
      if (ev.type === 'result' && ev.subtype === 'error_max_budget_usd') {
        costUsd = ev.total_cost_usd ?? null
        auditWrite({ event: 'budget_kill', job_id: job.id, cost_usd: costUsd, task_type: TASK_TYPE })
        throw new Error(`Budget cap exceeded ($${(costUsd ?? 0).toFixed(4)} / $${MAX_BUDGET_USD})`)
      }
      if (ev.type === 'result' && ev.subtype === 'error_during_generation') {
        costUsd = ev.total_cost_usd ?? null
        log(`error_during_generation: ${JSON.stringify(ev).slice(0, 300)}`)
      }
    }

    const doneTs = Date.now()
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare('UPDATE jobs SET status=?, result=?, cost_usd=?, updated_at=?, completed_at=? WHERE id=?')
      .run('COMPLETED', result, costUsd, doneTs, doneTs, job.id)
    db.prepare('INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), job.id, 'completed', AGENT_NAME, (result ?? '').slice(0, 500), doneTs)

    log(`Job ${job.id} completed`)
    auditWrite({ event: 'job_completed', job_id: job.id, cost_usd: costUsd, task_type: TASK_TYPE })
  } catch (err) {
    log(`Job ${job.id} failed: ${err.message}`)
    auditWrite({
      event: 'job_failed', job_id: job.id, error: err.message,
      error_code: classifyError(err.message), task_type: TASK_TYPE,
    })
    try {
      if (!db) db = new DatabaseSync(JOBS_DB)
      const t = Date.now()
      db.prepare('UPDATE jobs SET status=?, result=?, cost_usd=?, updated_at=? WHERE id=?')
        .run('FAILED', err.message, costUsd, t, job.id)
      db.prepare('INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), job.id, 'failed', AGENT_NAME, err.message, t)
    } catch {}
  } finally {
    clearInterval(heartbeat)
    _runToolCalls.delete(job.id)
    db?.close()
  }
}

// ── Poll loop ────────────────────────────────────────────────────────────────

let _running = false
let _lastNoProviderWarn = 0

async function poll () {
  if (!existsSync(JOBS_DB)) return

  const provider = detectProvider()
  if (!provider) {
    const now = Date.now()
    if (now - _lastNoProviderWarn > NO_PROVIDER_WARN_MS) {
      log('No calendar provider configured (GOOGLE_CLIENT_ID / MS365_CLIENT_ID both unset). Idle.')
      auditWrite({ event: 'no_provider_configured', task_type: TASK_TYPE })
      _lastNoProviderWarn = now
    }
    return
  }

  let db
  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()

    // Recover abandoned IN_PROGRESS jobs (heartbeat stale > 60s)
    const staleCut = Date.now() - 60_000
    const stale = db.prepare(
      "SELECT id FROM jobs WHERE task_type=? AND status='IN_PROGRESS' " +
      'AND (last_active IS NULL OR last_active < ?)',
    ).all(TASK_TYPE, staleCut)
    for (const j of stale) {
      db.prepare("UPDATE jobs SET status='APPROVED', last_active=NULL, updated_at=? WHERE id=?")
        .run(Date.now(), j.id)
      log(`Recovered stale IN_PROGRESS job ${j.id} -> APPROVED`)
    }

    const jobs = db.prepare(
      "SELECT * FROM jobs WHERE task_type=? AND status='APPROVED' ORDER BY created_at ASC LIMIT 5",
    ).all(TASK_TYPE)
    db.close()
    db = null

    for (const job of jobs) {
      if (_running) break
      _running = true
      try { await executeJob(job, provider) } finally { _running = false }
    }
  } catch (e) {
    log(`Poll error: ${e.message}`)
  } finally {
    db?.close()
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

log(`Starting -- slug=${COMPANY_SLUG} task_type=${TASK_TYPE} jobs_db=${JOBS_DB}`)
auditWrite({ event: 'agent_started', task_type: TASK_TYPE })

if (!existsSync(dirname(AUDIT_LOG))) {
  try { mkdirSync(dirname(AUDIT_LOG), { recursive: true }) } catch {}
}

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

poll()
setInterval(poll, POLL_MS)
