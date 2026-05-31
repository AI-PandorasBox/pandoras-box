#!/usr/bin/env node
// claude-bridge.mjs -- Claude Pro/Max subscription bridge with session persistence.
// Runs as a localhost-only service on port 7862 (configurable via PBOX_BRIDGE_PORT).
//
// POST /chat  { systemPrompt, messages, mcpConfigPath?, priority, chatSessionId? }
//             -> { text, durationMs, costUsd, claudeSessionId, resumed }
// GET  /health -> { ok, queue, slots, sessionCount }
//
// _BRIDGE_SESSION_PERSIST_V1 (supersedes _MCP_BRIDGE_V1)
//
// Session persistence: maps a caller-side chatSessionId (e.g. the auth session token)
// to a Claude Code session UUID. On resume, only the latest user turn is sent --
// Claude Code's internal cache hits across turns. System-prompt hash is stored so
// any change to the dynamic system prompt forces a fresh session for correctness.

import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash }   from 'node:crypto'
import { join }         from 'node:path'

const PORT         = parseInt(process.env.PBOX_BRIDGE_PORT || '7862', 10)
const CLAUDE       = process.env.PBOX_CLAUDE_BIN || 'claude'
const CALL_TIMEOUT = 2_200_000 // 25 min: longer than typical client ceilings; covers heavy multi-tool turns
const LOG_PREFIX   = '[claude-bridge]'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const STORE_DIR    = process.env.PBOX_BRIDGE_STORE || join(INSTALL_PATH, 'personal-ai', 'store')
const SESSION_STORE_PATH = join(STORE_DIR, 'claude-bridge-sessions.json')
const SESSION_TTL_MS     = 24 * 60 * 60 * 1000  // 24h

let sessions = {}  // chatSessionId -> { claudeSessionId, systemHash, lastUsedTs, turnCount }

function log (msg) { process.stdout.write(`${LOG_PREFIX} ${msg}\n`) }

function hashSystem (s) {
  return createHash('sha256').update(s || '').digest('hex').slice(0, 16)
}

function loadSessions () {
  try {
    if (existsSync(SESSION_STORE_PATH)) {
      sessions = JSON.parse(readFileSync(SESSION_STORE_PATH, 'utf8')) || {}
    }
  } catch (e) { log('session load failed: ' + e.message); sessions = {} }
  // GC stale
  const now = Date.now()
  let gc = 0
  for (const [k, v] of Object.entries(sessions)) {
    if (!v || !v.lastUsedTs || now - v.lastUsedTs > SESSION_TTL_MS) {
      delete sessions[k]; gc++
    }
  }
  if (gc) log('GC ' + gc + ' stale session(s)')
  saveSessions()
}

function saveSessions () {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(SESSION_STORE_PATH, JSON.stringify(sessions, null, 2), { mode: 0o600 }) // _BRIDGE_SESSION_PERMS_FIX_V1
  } catch (e) { log('session save failed: ' + e.message) }
}

// ── Priority queue + 2-slot concurrency ──────────────────────────────────────
const queue = []
let slotA = false
let slotB = false

// _STUCK_KILLER_V1 -- track active claude --print children, SIGTERM if 0% CPU >60s
const _activeChildren = new Map() // pid -> { startTs, _stuckCount, child }

function _stuckCheck () {
  for (const [pid, meta] of _activeChildren) {
    try {
      // execFileSync (no shell) -- pid is internally tracked, safe
      const cpuStr = execFileSync('ps', ['-p', String(pid), '-o', '%cpu='], { encoding: 'utf8' }).trim()
      if (!cpuStr) { _activeChildren.delete(pid); continue }
      const cpu = parseFloat(cpuStr) || 0
      const age = Date.now() - meta.startTs
      if (cpu < 0.5 && age > 600_000) {
        meta._stuckCount = (meta._stuckCount || 0) + 1
        if (meta._stuckCount >= 2) {
          log(`stuck-killer: PID ${pid} cpu=${cpu}% age=${Math.floor(age/1000)}s -- SIGTERM`)
          try { meta.child.kill('SIGTERM') } catch (e) {}
          _activeChildren.delete(pid)
        }
      } else {
        meta._stuckCount = 0
      }
    } catch (e) {
      // ps failed -- child likely exited; clean up
      _activeChildren.delete(pid)
    }
  }
}
setInterval(_stuckCheck, 30_000).unref()


function enqueue (priority, handler) {
  return new Promise((resolve, reject) => {
    queue.push({ priority, resolve, reject, handler })
    queue.sort((a, b) => a.priority - b.priority)
    drain()
  })
}

function drain () {
  if (!slotA) {
    const idx = queue.findIndex(i => i.priority <= 1)
    if (idx !== -1) {
      const item = queue.splice(idx, 1)[0]
      slotA = true
      item.handler().then(item.resolve, item.reject).finally(() => { slotA = false; drain() })
      return
    }
  }
  if (!slotB) {
    let idx = queue.findIndex(i => i.priority >= 2)
    if (idx === -1) idx = queue.findIndex(i => i.priority <= 1)
    if (idx !== -1) {
      const item = queue.splice(idx, 1)[0]
      slotB = true
      item.handler().then(item.resolve, item.reject).finally(() => { slotB = false; drain() })
    }
  }
}

// ── Run claude --print (with optional session resume) ────────────────────────
function runClaude (systemPrompt, message, mcpConfigPath, claudeSessionId, allowedTools) {
  return new Promise((resolve, reject) => {
    // Hardened headless tool use: no built-in tools (--tools ''), only the
    // explicitly allow-listed host MCP tools, and only the MCP config we pass
    // (--strict-mcp-config). No --dangerously-skip-permissions.
    const args = [
      '--print',
      '--output-format', 'json',
      '--tools', '',
    ]
    if (claudeSessionId) {
      args.push('--resume', claudeSessionId)
      // On resume the session retains the original system prompt.
    } else {
      if (systemPrompt) args.push('--system-prompt', systemPrompt)
    }
    if (mcpConfigPath) args.push('--strict-mcp-config', '--mcp-config', mcpConfigPath)
    if (allowedTools && allowedTools.length) args.push('--allowed-tools', ...allowedTools)
    args.push('--', message)

    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      // Give the MCP tool server generous time to initialise. On a slow/loaded box
      // (notably the first chat right after install) the default startup window can
      // be exceeded, leaving the model with no tools for that call. _BRIDGE_MCP_TIMEOUT_V1
      MCP_TIMEOUT: process.env.MCP_TIMEOUT || '60000',
      MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT || '120000',
    }

    const child  = spawn(CLAUDE, args, { env, cwd: '/tmp' })
    if (child.pid) _activeChildren.set(child.pid, { startTs: Date.now(), _stuckCount: 0, child }) // _STUCK_KILLER_V1
    let   stdout = ''
    let   stderr = ''
    const timer  = setTimeout(() => { child.kill(); reject(new Error('claude --print timeout')) }, CALL_TIMEOUT)

    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => {
      clearTimeout(timer)
      if (child.pid) _activeChildren.delete(child.pid) // _STUCK_KILLER_V1
      try {
        const parsed = JSON.parse(stdout.trim())
        if (parsed.is_error && parsed.result?.includes('Not logged in')) {
          return reject(new Error('Claude: not logged in -- OAuth session missing'))
        }
        // Surface a resume failure via a typed error so caller can fall back
        if (parsed.is_error && /resume|session.*not.*found|invalid.*session/i.test(parsed.result || '')) {
          const err = new Error('claude resume failed: ' + (parsed.result || '').slice(0, 200))
          err.code = 'RESUME_FAILED'
          return reject(err)
        }
        resolve(parsed)
      } catch {
        reject(new Error(`claude parse error (code ${code}): ${stdout.slice(0, 300)} | stderr: ${stderr.slice(0, 200)}`))
      }
    })
    child.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

// ── Core chat handler ────────────────────────────────────────────────────────
function _extractText (m) {
  return Array.isArray(m.content)
    ? m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
    : String(m.content || '')
}

function _buildFullUserMsg (messages) {
  const turns = (messages || []).map(m => {
    const role = m.role === 'assistant' ? 'Assistant' : 'User'
    return `${role}: ${_extractText(m)}`
  })
  const lastTurn   = turns.at(-1) || ''
  const priorTurns = turns.slice(0, -1)
  return priorTurns.length
    ? `[Earlier conversation]\n${priorTurns.join('\n\n')}\n\n[Current message]\n${lastTurn}`
    : lastTurn
}

async function handleChat ({ systemPrompt, messages, mcpConfigPath, chatSessionId, allowedTools }) {
  const t0         = Date.now()
  const sysHash    = hashSystem(systemPrompt)
  const existing   = chatSessionId ? sessions[chatSessionId] : null
  const canResume  = !!existing && existing.systemHash === sysHash && !!existing.claudeSessionId
  let claudeSessionId = canResume ? existing.claudeSessionId : null
  let resumed = false

  // Build user message: on resume, just the last user turn; otherwise full collapsed history.
  const lastUserTurn = (messages || []).filter(m => m.role === 'user').at(-1)
  const lastTextOnly = lastUserTurn ? _extractText(lastUserTurn) : ''
  let userMsg = canResume ? lastTextOnly : _buildFullUserMsg(messages)

  let result
  try {
    result = await runClaude(systemPrompt, userMsg, mcpConfigPath, claudeSessionId, allowedTools)
    if (canResume) resumed = true
  } catch (e) {
    if (e.code === 'RESUME_FAILED' && claudeSessionId) {
      log('resume failed for ' + chatSessionId.slice(0, 8) + '*, falling back to fresh: ' + e.message.slice(0, 80))
      delete sessions[chatSessionId]; saveSessions()
      claudeSessionId = null
      userMsg = _buildFullUserMsg(messages)
      result = await runClaude(systemPrompt, userMsg, mcpConfigPath, null, allowedTools)
    } else {
      throw e
    }
  }

  const text = (result.result || '').trim()

  // Capture / refresh session_id mapping
  if (chatSessionId && result.session_id) {
    sessions[chatSessionId] = {
      claudeSessionId: result.session_id,
      systemHash:      sysHash,
      lastUsedTs:      Date.now(),
      turnCount:       (existing?.turnCount || 0) + 1
    }
    saveSessions()
  }

  return {
    text,
    durationMs:       Date.now() - t0,
    costUsd:          result.cost_usd || result.total_cost || 0,
    claudeSessionId:  result.session_id || null,
    resumed,
  }
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({
      ok: true,
      slots: { A: slotA, B: slotB },
      queued: queue.length,
      sessionCount: Object.keys(sessions).length,
    }))
    return
  }

  const remoteAddr = req.socket.remoteAddress || ''
  if (!remoteAddr.includes('127.0.0.1') && !remoteAddr.includes('::1') && !remoteAddr.includes('::ffff:127')) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: 'localhost only' }))
    return
  }

  if (req.method !== 'POST' || req.url !== '/chat') {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  let body = ''
  req.on('data', d => { body += d })
  req.on('end', async () => {
    let payload
    try { payload = JSON.parse(body) } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'invalid JSON' }))
      return
    }

    const priority = Number(payload.priority ?? 0)

    try {
      const result = await enqueue(priority, () => handleChat(payload))
      log(`Done [P${priority}] ${result.durationMs}ms${result.resumed ? ' (resumed)' : ' (fresh)'}`)
      res.end(JSON.stringify(result))
    } catch (err) {
      log(`Error: ${err.message}`)
      res.statusCode = 500
      res.end(JSON.stringify({ error: err.message }))
    }
  })
})

loadSessions()
server.listen(PORT, '127.0.0.1', () => {
  log(`Listening on 127.0.0.1:${PORT} (session-persist edition; ${Object.keys(sessions).length} stored)`)
})

server.on('error', err => {
  log(`Server error: ${err.message}`)
  process.exit(1)
})
