#!/usr/bin/env node
/**
 * pbox-voice-agent -- per-tenant voice (TTS / STT) task agent for Pandora's Box v0.5.x
 *
 * Tenant-agnostic, multi-provider runtime. Polls the per-tenant jobs.db for
 * APPROVED jobs with task_type='voice' and executes them via the Claude Agent SDK.
 *
 * Provider selection (env-driven):
 *   - ELEVENLABS_API_KEY set -> ElevenLabs TTS available
 *   - GROQ_API_KEY set       -> Groq Whisper STT available
 *   - Neither                -> agent stays alive but warns every 5 min;
 *                               no jobs are processed
 *
 * Tool scope:
 *   - Allowed: WebFetch + Bash (for `curl` to ElevenLabs / Groq HTTPS endpoints).
 *     Bash content is regex-checked: only curl invocations to api.elevenlabs.io
 *     or api.groq.com pass; anything else is denied at canUseTool.
 *   - Blocked: every mail / calendar / files MCP surface (voice has no business
 *     data scope); generic Write / Edit / MultiEdit / NotebookEdit (no local
 *     code edits permitted).
 *
 * Audio output:
 *   - Generated files land in <tenant>/store/voice-output/<job-id>.<ext>
 *     (mp3 for TTS, txt for STT transcript). The operator-supplied prompt
 *     determines voice_id + content. Per-tenant voice config at
 *     <tenant>/store/voice-config.json lists allowed voice_ids and defaults.
 *
 * Contract: docs/architecture/v0.5-multi-tenant.md
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { DatabaseSync } from 'node:sqlite'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// ── Env-driven config ─────────────────────────────────────────────────────────

const COMPANY_SLUG = process.env.COMPANY_SLUG
const INSTALL_PATH = process.env.INSTALL_PATH
const TASK_TYPE    = 'voice'

if (!COMPANY_SLUG || !INSTALL_PATH) {
  console.error('[pbox-voice-agent] FATAL: COMPANY_SLUG and INSTALL_PATH must be set in env')
  process.exit(1)
}

const AGENT_NAME    = `${COMPANY_SLUG}-voice`
const PROJECT       = `${INSTALL_PATH}/${AGENT_NAME}`
const TENANT_ROOT   = `${INSTALL_PATH}/${COMPANY_SLUG}`
const JOBS_DB       = `${TENANT_ROOT}/store/jobs.db`
const AUDIT_LOG     = `${TENANT_ROOT}/logs/audit.log`
const VOICE_OUTPUT  = `${TENANT_ROOT}/store/voice-output`
const VOICE_CONFIG  = `${TENANT_ROOT}/store/voice-config.json`
const SETTINGS_JSON = `${PROJECT}/.claude/settings.json`

const POLL_MS              = Number(process.env.JOB_POLL_MS ?? 30_000)
const HEARTBEAT_MS         = 15_000
const TOOL_RETRY_CAP       = 10
const MAX_BUDGET_USD       = Number(process.env.MAX_BUDGET_USD ?? 5)
const MAX_TURNS            = Number(process.env.MAX_TURNS ?? 10)
const NO_PROVIDER_WARN_MS  = 5 * 60_000

// Provider detection (re-evaluated every poll so .env edits pick up live)
function detectProviders () {
  return {
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    groq:       !!process.env.GROQ_API_KEY,
  }
}

function loadVoiceConfig () {
  try {
    return JSON.parse(readFileSync(VOICE_CONFIG, 'utf-8'))
  } catch {
    return { voices: {}, default_voice_id: null }
  }
}

function loadMcpServers () {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
    return s.mcpServers ?? {}
  } catch { return {} }
}

// ── Logging + audit ──────────────────────────────────────────────────────────

function log (msg) {
  console.log(`[${new Date().toISOString()}] [${AGENT_NAME}] ${msg}`)
}

function auditWrite (event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: AGENT_NAME,
    slug: COMPANY_SLUG,
    task_type: TASK_TYPE,
    ...event,
  }) + '\n'
  try {
    if (!existsSync(dirname(AUDIT_LOG))) mkdirSync(dirname(AUDIT_LOG), { recursive: true })
    appendFileSync(AUDIT_LOG, line)
  } catch {}
}

function classifyError (msg) {
  const s = (msg ?? '').toLowerCase()
  if (/abort|econnreset|etimedout|econnrefused|timed out|timeout/.test(s)) return 'timeout'
  if (/429|rate.?limit|too many requests/.test(s)) return 'rate_limited'
  if (/401|403|authentication|unauthorized|forbidden/.test(s)) return 'auth_failed'
  if (/budget cap exceeded/.test(s)) return 'budget_exceeded'
  return 'unknown'
}

// ── Tool gating ──────────────────────────────────────────────────────────────
//
// Voice agent runs in a narrow scope:
//  - It can call ElevenLabs (TTS) and Groq (STT) HTTPS endpoints.
//  - It can write/read its own voice-output dir.
//  - It cannot touch mail / calendar / files.
//
// We allow Bash so curl-to-API is possible, but inspect the Bash command string
// at canUseTool time -- only curls to the two whitelisted hosts pass.

const BLOCKED_TOOL_PATTERNS = [
  // Anything mail / calendar / files via any MCP provider
  /mcp__(ms365|gmail|google)__/i,
  // Local-edit SDK builtins; voice agent should never modify source.
  /^Write$/, /^Edit$/, /^MultiEdit$/, /^NotebookEdit$/,
]

const BASH_HOST_ALLOWLIST = [
  /\bcurl\b[^|&;`$]*\bhttps:\/\/api\.elevenlabs\.io\b/i,
  /\bcurl\b[^|&;`$]*\bhttps:\/\/api\.groq\.com\b/i,
]

// Patterns that must never appear inside a Bash command body, even if the curl
// destination is allowlisted. Prevents pipe-chain / subshell escapes.
const BASH_REFUSE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bnc\b\s/i,
  /\bdd\b\s/i,
  /\bchmod\s+777\b/i,
  /\b\/dev\/tcp\//i,
  /\bcurl\b[^|&;`$]*-o\s+\//i,    // -o writes outside CWD
]

function isAllowedBash (toolArgs) {
  const cmd = String(toolArgs?.command ?? toolArgs?.cmd ?? '')
  if (!cmd) return false
  for (const refuse of BASH_REFUSE_PATTERNS) if (refuse.test(cmd)) return false
  for (const allow of BASH_HOST_ALLOWLIST)   if (allow.test(cmd)) return true
  return false
}

const _runToolCalls = new Map()

function buildCanUseTool (jobId) {
  return function canUseTool (toolName, toolArgs) {
    if (!_runToolCalls.has(jobId)) _runToolCalls.set(jobId, new Map())
    const counts = _runToolCalls.get(jobId)
    const count  = (counts.get(toolName) ?? 0) + 1
    counts.set(toolName, count)
    if (count > TOOL_RETRY_CAP) {
      auditWrite({ event: 'retry_cap_hit', tool: toolName, count, job_id: jobId })
      return {
        behavior: 'deny',
        message:  `Tool ${toolName} called ${count}x in this job. Retry cap (${TOOL_RETRY_CAP}) hit -- possible loop.`,
        interrupt: true,
      }
    }
    if (BLOCKED_TOOL_PATTERNS.some(p => p.test(toolName))) {
      auditWrite({ event: 'tool_denied', tool: toolName, reason: 'out_of_scope', job_id: jobId })
      return { behavior: 'deny', message: `${AGENT_NAME}: ${toolName} is outside voice scope.`, interrupt: false }
    }
    if (toolName === 'Bash') {
      if (!isAllowedBash(toolArgs)) {
        auditWrite({ event: 'tool_denied', tool: 'Bash', reason: 'bash_command_not_in_allowlist', job_id: jobId, cmd: String(toolArgs?.command ?? '').slice(0, 200) })
        return {
          behavior: 'deny',
          message: `${AGENT_NAME}: Bash limited to curl to api.elevenlabs.io / api.groq.com. Use WebFetch for other GETs, or refuse the job.`,
          interrupt: false,
        }
      }
    }
    return { behavior: 'allow' }
  }
}

// ── Per-job session reset (avoid SDK resuming stale conversations) ───────────

function clearProjectSessions () {
  try {
    const home = process.env.HOME ?? ''
    if (!home) return
    const encoded = PROJECT.replace(/\//g, '-')
    const dir = `${home}/.claude/projects/${encoded}`
    if (!existsSync(dir)) return
    for (const f of readFileSyncDir(dir)) {
      if (f.endsWith('.jsonl')) {
        try { unlinkSync(`${dir}/${f}`) } catch {}
      }
    }
  } catch {}
}

function readFileSyncDir (dir) {
  try { return require('node:fs').readdirSync(dir) } catch { return [] }
}

// ── Job execution ────────────────────────────────────────────────────────────

async function executeJob (job) {
  const providers = detectProviders()
  if (!providers.elevenlabs && !providers.groq) {
    log(`Job ${job.id} found but no voice provider configured -- skipping.`)
    auditWrite({ event: 'job_skipped', job_id: job.id, reason: 'no_provider' })
    return
  }

  if (!existsSync(VOICE_OUTPUT)) {
    try { mkdirSync(VOICE_OUTPUT, { recursive: true }) } catch {}
  }

  const startedAt = Date.now()
  let db
  let heartbeat
  let costUsd = null
  let streamed = ''

  try {
    db = new DatabaseSync(JOBS_DB)
    db.prepare('PRAGMA busy_timeout=5000').run()
    db.prepare('UPDATE jobs SET status=?, updated_at=?, last_active=? WHERE id=?')
      .run('IN_PROGRESS', startedAt, startedAt, job.id)
    db.prepare(
      'INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), job.id, 'started', AGENT_NAME, JSON.stringify({ providers }), startedAt)
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

    log(`Executing job ${job.id} (providers=${Object.entries(providers).filter(([,v])=>v).map(([k])=>k).join(',')})`)
    auditWrite({ event: 'job_started', job_id: job.id, providers })

    const voiceCfg = loadVoiceConfig()
    const env = { ...process.env }
    delete env.CLAUDECODE
    clearProjectSessions()

    const systemContext = [
      `You are ${AGENT_NAME}, the voice task agent for tenant '${COMPANY_SLUG}'.`,
      'Scope: ElevenLabs TTS + Groq Whisper STT. No other capabilities.',
      `Audio output directory: ${VOICE_OUTPUT}/`,
      `Use job ID '${job.id}' as the basename for any generated file.`,
      voiceCfg.default_voice_id
        ? `Default voice_id for TTS: ${voiceCfg.default_voice_id}`
        : 'No default voice_id is configured for this tenant -- if the job does not specify one, refuse and ask.',
      voiceCfg.voices && Object.keys(voiceCfg.voices).length
        ? `Allowed voice_ids: ${Object.keys(voiceCfg.voices).join(', ')}.`
        : 'No voice_id allowlist is configured (any operator-supplied voice_id is permitted).',
      'Bash is whitelisted only for curl to api.elevenlabs.io and api.groq.com.',
      'When done, return JSON {"output_path":"...","kind":"tts|stt","duration_seconds":N}.',
    ].join('\n')

    const events = query({
      prompt: `[Approved voice job -- id ${job.id} -- providers: ${JSON.stringify(providers)}]\n\n${systemContext}\n\n${job.prompt}`,
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
        canUseTool: buildCanUseTool(job.id),
      },
    })

    let result = null
    for await (const ev of events) {
      if (ev.type === 'tool_use') {
        auditWrite({ event: 'tool_span', job_id: job.id, tool_name: ev.name })
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
        auditWrite({ event: 'budget_kill', job_id: job.id, cost_usd: costUsd })
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
    auditWrite({ event: 'job_completed', job_id: job.id, cost_usd: costUsd })
  } catch (err) {
    log(`Job ${job.id} failed: ${err.message}`)
    auditWrite({
      event: 'job_failed', job_id: job.id, error: err.message,
      error_code: classifyError(err.message),
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

  const providers = detectProviders()
  if (!providers.elevenlabs && !providers.groq) {
    const now = Date.now()
    if (now - _lastNoProviderWarn > NO_PROVIDER_WARN_MS) {
      log('No voice provider configured (ELEVENLABS_API_KEY / GROQ_API_KEY both unset). Idle.')
      auditWrite({ event: 'no_provider', detail: 'ELEVENLABS_API_KEY and GROQ_API_KEY both unset' })
      _lastNoProviderWarn = now
    }
    return
  }

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
const bootProviders = detectProviders()
log(`Providers at boot: ${JSON.stringify(bootProviders)}`)
auditWrite({ event: 'agent_started', providers: bootProviders, poll_ms: POLL_MS })

// Idempotent schema migrations (older deployments may pre-date these columns).
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

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`Received ${sig} -- exiting.`)
    auditWrite({ event: 'agent_stopped', signal: sig })
    process.exit(0)
  })
}

poll()
setInterval(poll, POLL_MS)
