#!/usr/bin/env node
/**
 * pbox-files-agent.mjs -- per-tenant files task agent
 *
 * Multi-provider: SharePoint (Microsoft Graph) and Google Drive.
 * Polls ${INSTALL_PATH}/${COMPANY_SLUG}/store/jobs.db for APPROVED jobs of
 * task_type='files', executes them via @anthropic-ai/claude-agent-sdk,
 * and writes results back. See docs/architecture/v0.5-multi-tenant.md.
 *
 * Files-specific security model:
 *  - READ / SEARCH        -> auto-allowed (audit-logged)
 *  - WRITE / CREATE /
 *    MODIFY / COPY / MOVE -> allowlist-gated; if target path is not in the
 *                            tenant write allowlist, a PENDING_REVIEW
 *                            sub-job (risk_level='high') is inserted and
 *                            the tool call is denied
 *  - DELETE               -> always denied; PENDING_REVIEW sub-job inserted
 *  - Upload size cap      -> FILES_UPLOAD_MAX_BYTES (default 100 MB)
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

// ── Required env ─────────────────────────────────────────────────────────────
const COMPANY_SLUG = process.env.COMPANY_SLUG
const INSTALL_PATH = process.env.INSTALL_PATH
if (!COMPANY_SLUG || !INSTALL_PATH) {
  console.error('[pbox-files-agent] COMPANY_SLUG and INSTALL_PATH env vars are required.')
  process.exit(2)
}

const TASK_TYPE   = 'files'
const AGENT_NAME  = `${COMPANY_SLUG}-files`
const TENANT_DIR  = path.join(INSTALL_PATH, COMPANY_SLUG)
const PROJECT_DIR = path.join(INSTALL_PATH, `${COMPANY_SLUG}-files`)
const JOBS_DB     = path.join(TENANT_DIR, 'store', 'jobs.db')
const AUDIT_LOG   = path.join(TENANT_DIR, 'logs', 'audit.log')
const ALLOWLIST_PATH = path.join(TENANT_DIR, 'store', 'files-write-allowlist.txt')

const POLL_MS      = parseInt(process.env.JOB_POLL_MS || '30000', 10)
const HEARTBEAT_MS = 15_000
const TOOL_RETRY_CAP = 10
const UPLOAD_MAX_BYTES = parseInt(process.env.FILES_UPLOAD_MAX_BYTES || `${100 * 1024 * 1024}`, 10)

const NO_PROVIDER_NOTIFY_MS = 5 * 60 * 1000
let _lastNoProviderNotify = 0

// Ensure audit log dir exists
try { mkdirSync(path.dirname(AUDIT_LOG), { recursive: true }) } catch {}

// ── Provider detection ───────────────────────────────────────────────────────
function detectProvider() {
  const hasGoogle = !!process.env.GOOGLE_CLIENT_ID
  const hasMs365  = !!process.env.MS365_CLIENT_ID
  if (!hasGoogle && !hasMs365) return null
  if (hasGoogle && !hasMs365) return 'google'
  if (hasMs365 && !hasGoogle) return 'ms365'
  // Both set -- pick most recently authenticated (token-cache dir mtime)
  const gMtime = safeMtime(path.join(TENANT_DIR, 'store', 'google-auth'))
  const mMtime = safeMtime(path.join(TENANT_DIR, 'store', 'ms365-auth'))
  return gMtime >= mMtime ? 'google' : 'ms365'
}
function safeMtime(p) {
  try { return statSync(p).mtimeMs } catch { return 0 }
}

// ── MCP server config (per-tenant) ───────────────────────────────────────────
function loadMcpServers() {
  try {
    const cfgPath = path.join(PROJECT_DIR, '.claude', 'settings.json')
    const s = JSON.parse(readFileSync(cfgPath, 'utf-8'))
    return s.mcpServers ?? {}
  } catch { return {} }
}
const MCP_SERVERS = loadMcpServers()

// ── Clear stored SDK sessions for this project so each job starts fresh ──────
function clearProjectSessions() {
  try {
    const home = process.env.HOME ?? ''
    if (!home) return
    const encoded = PROJECT_DIR.replace(/\//g, '-')
    const dir = path.join(home, '.claude', 'projects', encoded)
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.jsonl')) unlinkSync(path.join(dir, f))
    }
  } catch { /* no prior sessions -- fine */ }
}

// ── Audit log ────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] [${AGENT_NAME}] ${msg}`)
}
function auditWrite(event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: AGENT_NAME,
    tenant: COMPANY_SLUG,
    task_type: TASK_TYPE,
    ...event,
  }) + '\n'
  try { appendFileSync(AUDIT_LOG, line) } catch {}
}

// ── Write allowlist (operator-edited per-tenant file) ────────────────────────
function loadWriteAllowlist() {
  try {
    return readFileSync(ALLOWLIST_PATH, 'utf-8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  } catch { return [] }
}
function targetMatchesAllowlist(targetPath, prefixes) {
  if (!targetPath) return false
  return prefixes.some(p => targetPath === p || targetPath.startsWith(p.endsWith('/') ? p : `${p}/`))
}

// ── Tool classification ──────────────────────────────────────────────────────
// Conservative pattern: read/search/list/get/download are read-only;
// write/create/upload/update/modify/copy/move are write operations;
// delete/remove/trash are deletes. Everything else is treated as read by default
// (unknown MCP tools won't be silently elevated to "write").
const DELETE_RE = /(?:^|[_-])(delete|remove|trash)(?:[_-]|$)/i
const WRITE_RE  = /(?:^|[_-])(write|create|upload|update|modify|put|patch|post|copy|move|rename|mkdir|new)(?:[_-]|$)/i

function classifyToolOperation(toolName) {
  if (DELETE_RE.test(toolName)) return 'delete'
  if (WRITE_RE.test(toolName))  return 'write'
  return 'read'
}

// Best-effort extraction of a target path/identifier from tool input
function extractTarget(input) {
  if (!input || typeof input !== 'object') return null
  const keys = [
    'path', 'target_path', 'targetPath', 'destination', 'dest', 'destPath',
    'file_path', 'filePath', 'remote_path', 'remotePath', 'parent_path',
    'parentPath', 'folder_path', 'folderPath', 'drive_path', 'name', 'file_id',
    'fileId', 'item_id', 'itemId',
  ]
  for (const k of keys) {
    if (typeof input[k] === 'string' && input[k]) return input[k]
  }
  return null
}

function extractUploadSize(input) {
  if (!input || typeof input !== 'object') return 0
  if (typeof input.content === 'string') return Buffer.byteLength(input.content, 'utf8')
  if (typeof input.size === 'number') return input.size
  if (typeof input.bytes === 'number') return input.bytes
  return 0
}

// Insert a PENDING_REVIEW sub-job describing a write/delete that needs approval
function queueApprovalSubJob(parentJobId, toolName, op, input) {
  const id = randomUUID()
  const now = Date.now()
  const prompt = JSON.stringify({
    kind: 'files_write_approval_request',
    parent_job_id: parentJobId,
    operation: op,
    tool: toolName,
    target: extractTarget(input),
    input,
  }, null, 2)
  let db
  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare(`
      INSERT INTO jobs (id, task_type, prompt, status, risk_level,
                       conductor_ref, created_at, updated_at)
      VALUES (?, ?, ?, 'PENDING_REVIEW', 'high', ?, ?, ?)
    `).run(id, TASK_TYPE, prompt, parentJobId, now, now)
    db.prepare(`
      INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at)
      VALUES (?, ?, 'created', ?, ?, ?)
    `).run(randomUUID(), id, AGENT_NAME, `Approval request for ${op} via ${toolName}`, now)
    auditWrite({
      event: 'approval_subjob_queued',
      parent_job_id: parentJobId,
      sub_job_id: id,
      operation: op,
      tool: toolName,
      target: extractTarget(input),
    })
    return id
  } catch (e) {
    auditWrite({ event: 'approval_subjob_failed', parent_job_id: parentJobId, error: e.message })
    return null
  } finally {
    db?.close()
  }
}

// ── canUseTool callback ──────────────────────────────────────────────────────
const _runToolCalls = new Map() // jobId -> Map<toolName, count>

function buildCanUseTool(jobId) {
  return function canUseTool(toolName, input) {
    // Retry cap
    if (!_runToolCalls.has(jobId)) _runToolCalls.set(jobId, new Map())
    const counts = _runToolCalls.get(jobId)
    const callCount = (counts.get(toolName) ?? 0) + 1
    counts.set(toolName, callCount)
    if (callCount > TOOL_RETRY_CAP) {
      auditWrite({
        event: 'retry_cap_hit',
        tool: toolName,
        count: callCount,
        job_id: jobId,
      })
      return {
        behavior: 'deny',
        message: `Tool ${toolName} called ${callCount} times this run -- retry cap hit. Possible loop.`,
        interrupt: true,
      }
    }

    const op = classifyToolOperation(toolName)

    // Upload size cap (applies to write-class operations)
    if (op === 'write') {
      const size = extractUploadSize(input)
      if (size > UPLOAD_MAX_BYTES) {
        auditWrite({
          event: 'upload_size_denied',
          tool: toolName,
          size,
          cap: UPLOAD_MAX_BYTES,
          job_id: jobId,
        })
        return {
          behavior: 'deny',
          message: `Upload size ${size} exceeds FILES_UPLOAD_MAX_BYTES (${UPLOAD_MAX_BYTES}).`,
        }
      }
    }

    if (op === 'delete') {
      const subJobId = queueApprovalSubJob(jobId, toolName, 'delete', input)
      return {
        behavior: 'deny',
        message: `Delete operations require operator approval. Sub-job ${subJobId ?? '(queue-failed)'} created with risk_level='high'.`,
      }
    }

    if (op === 'write') {
      const target = extractTarget(input)
      const allowlist = loadWriteAllowlist()
      if (target && targetMatchesAllowlist(target, allowlist)) {
        auditWrite({
          event: 'write_auto_allowed',
          tool: toolName,
          target,
          job_id: jobId,
        })
        return { behavior: 'allow' }
      }
      const subJobId = queueApprovalSubJob(jobId, toolName, 'write', input)
      return {
        behavior: 'deny',
        message: `Write/copy/move target ${target ?? '(unknown)'} is not in files-write-allowlist.txt. Sub-job ${subJobId ?? '(queue-failed)'} created with risk_level='high'.`,
      }
    }

    // Read / search / unknown -- audit and allow
    auditWrite({ event: 'tool_allowed', tool: toolName, operation: op, job_id: jobId })
    return { behavior: 'allow' }
  }
}

// ── Error classification ─────────────────────────────────────────────────────
function classifyError(msg) {
  const s = (msg ?? '').toLowerCase()
  if (/abort|econnreset|etimedout|econnrefused|timed out|timeout/.test(s)) return 'timeout'
  if (/429|rate.?limit|too many requests/.test(s)) return 'rate_limited'
  if (/401|403|authentication|re-auth|unauthorized|forbidden/.test(s)) return 'auth_failed'
  if (/budget cap exceeded/.test(s)) return 'budget_exceeded'
  return 'unknown'
}

// ── Job execution ────────────────────────────────────────────────────────────
async function executeJob(job) {
  const provider = detectProvider()
  if (!provider) {
    const now = Date.now()
    if (now - _lastNoProviderNotify > NO_PROVIDER_NOTIFY_MS) {
      _lastNoProviderNotify = now
      log('no provider configured -- set GOOGLE_CLIENT_ID or MS365_CLIENT_ID in .env')
      auditWrite({ event: 'no_provider_configured', job_id: job.id })
    }
    // Park the job back as APPROVED so it is retried; do not fail it.
    return
  }

  const now = Date.now()
  let db
  let heartbeat
  let costUsd = null

  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE id=?').run('IN_PROGRESS', now, job.id)
    db.prepare(`
      INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at)
      VALUES (?, ?, 'started', ?, ?, ?)
    `).run(randomUUID(), job.id, AGENT_NAME, JSON.stringify({ provider }), now)
    db.close()
    db = null

    heartbeat = setInterval(() => {
      let hdb
      try {
        hdb = new DatabaseSync(JOBS_DB)
        hdb.prepare('PRAGMA busy_timeout=5000').run()
        hdb.prepare('UPDATE jobs SET last_active=? WHERE id=?')
          .run(Date.now(), job.id)
      } catch {} finally { hdb?.close() }
    }, HEARTBEAT_MS)

    log(`Executing job ${job.id} (provider=${provider})`)
    auditWrite({ event: 'job_started', job_id: job.id, provider })

    let result = null
    const env = { ...process.env }
    delete env.CLAUDECODE
    clearProjectSessions()

    const events = query({
      prompt: `[Approved job from queue -- job ID: ${job.id}]\n\n${job.prompt}`,
      options: {
        cwd: PROJECT_DIR,
        settingSources: ['project'],
        mcpServers: MCP_SERVERS,
        permissionMode: 'bypassPermissions',
        continue: false,
        persistSession: false,
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: 5,
        maxTurns: 100,
        env,
        canUseTool: buildCanUseTool(job.id),
      },
    })

    let streamedText = ''
    for await (const ev of events) {
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
          if (fi >= 0 && li > fi) result = streamedText.slice(fi, li + 1)
        }
      }
      if (ev.type === 'result' && ev.subtype === 'error_max_budget_usd') {
        costUsd = ev.total_cost_usd ?? null
        auditWrite({ event: 'budget_kill', job_id: job.id, cost_usd: costUsd })
        throw new Error(`Budget cap exceeded ($${(costUsd ?? 0).toFixed(4)} / $5.00)`)
      }
      if (ev.type === 'result' && ev.subtype === 'error_during_generation') {
        costUsd = ev.total_cost_usd ?? null
        log(`[claude error_event] ${JSON.stringify(ev)}`)
      }
    }

    const done = Date.now()
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare(`
      UPDATE jobs SET status=?, result=?, cost_usd=?, updated_at=?, completed_at=?
       WHERE id=?
    `).run('COMPLETED', result, costUsd, done, done, job.id)
    db.prepare(`
      INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at)
      VALUES (?, ?, 'completed', ?, ?, ?)
    `).run(randomUUID(), job.id, AGENT_NAME, result?.slice(0, 500) ?? null, done)

    log(`Job ${job.id} completed`)
    auditWrite({ event: 'job_completed', job_id: job.id, cost_usd: costUsd })
  } catch (err) {
    log(`Job ${job.id} failed: ${err.message}`)
    auditWrite({
      event: 'job_failed',
      job_id: job.id,
      error: err.message,
      error_code: classifyError(err.message),
    })
    try {
      if (!db) db = new DatabaseSync(JOBS_DB)
      const t = Date.now()
      db.prepare(`
        UPDATE jobs SET status=?, result=?, cost_usd=?, updated_at=?
         WHERE id=?
      `).run('FAILED', err.message, costUsd, t, job.id)
      db.prepare(`
        INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at)
        VALUES (?, ?, 'failed', ?, ?, ?)
      `).run(randomUUID(), job.id, AGENT_NAME, err.message, t)
    } catch {}
  } finally {
    clearInterval(heartbeat)
    _runToolCalls.delete(job.id)
    db?.close()
  }
}

// ── Poll loop ────────────────────────────────────────────────────────────────
let _running = false

async function poll() {
  if (!existsSync(JOBS_DB)) return
  let db
  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    // Recover abandoned IN_PROGRESS jobs (heartbeat stale > 60s)
    const staleTime = Date.now() - 60_000
    const stale = db.prepare(`
      SELECT id FROM jobs
       WHERE task_type=? AND status='IN_PROGRESS'
         AND (last_active IS NULL OR last_active < ?)
    `).all(TASK_TYPE, staleTime)
    for (const j of stale) {
      db.prepare(`
        UPDATE jobs SET status='APPROVED', last_active=NULL, updated_at=?
         WHERE id=?
      `).run(Date.now(), j.id)
      log(`Recovered stale IN_PROGRESS job ${j.id} -> APPROVED`)
    }
    const jobs = db.prepare(`
      SELECT * FROM jobs
       WHERE task_type=? AND status='APPROVED'
       ORDER BY created_at ASC LIMIT 5
    `).all(TASK_TYPE)
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
    db?.close()
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
log(`Starting -- tenant=${COMPANY_SLUG} task_type=${TASK_TYPE}`)
auditWrite({ event: 'agent_started' })

// Idempotent schema migrations (older deployments may pre-date these columns)
for (const stmt of [
  'ALTER TABLE jobs ADD COLUMN last_active INTEGER',
  'ALTER TABLE jobs ADD COLUMN cost_usd REAL',
  'ALTER TABLE jobs ADD COLUMN risk_level TEXT NOT NULL DEFAULT \'standard\'',
]) {
  let mdb
  try {
    mdb = new DatabaseSync(JOBS_DB)
    mdb.prepare('PRAGMA busy_timeout=5000').run()
    mdb.prepare(stmt).run()
  } catch { /* column exists */ } finally { mdb?.close() }
}

poll()
setInterval(poll, POLL_MS)
