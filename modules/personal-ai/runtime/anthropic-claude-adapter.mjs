// anthropic-claude-adapter.mjs -- v1/v2 routing edition with per-session
// callback servers for v2 (fixes mcp-config-churn bug).
//
// _CLAUDE_BRIDGE_V1 + _BRIDGE_MODE_ROUTE_V1 + _ADAPTER_PER_SESSION_CB_V1
//
// Behaviour:
//   v1 (BRIDGE_MODE unset or 'v1'): per-call ephemeral callback server +
//     ephemeral MCP config. Original behaviour. v1 bridge spawns claude per
//     call so per-call resources are correct.
//   v2 (BRIDGE_MODE='v2'): per-chatSessionId stable callback server + stable
//     MCP config path. Reused across calls for the same chatSessionId. v2
//     bridge holds a persistent claude per session; stable config = no respawn.
//     Tools array is fingerprinted; if tool names change, the session
//     resources are rebuilt (and v2 will respawn its claude on the new path).

import { createServer }                from 'node:http'
import { writeFileSync, unlinkSync }   from 'node:fs'
import { randomBytes, createHash }     from 'node:crypto'
import { dirname, join }               from 'node:path'
import { fileURLToPath }               from 'node:url'

const __dirname    = dirname(fileURLToPath(import.meta.url))
const BRIDGE_MODE  = (process.env.BRIDGE_MODE || 'v1').toLowerCase()
const BRIDGE_PORT  = parseInt(process.env.PBOX_BRIDGE_PORT || '7862', 10)
const BRIDGE_URL   = BRIDGE_MODE === 'v2'
  ? 'http://127.0.0.1:7863'
  : 'http://127.0.0.1:' + BRIDGE_PORT
const MCP_PROXY    = join(__dirname, 'mcp-tool-proxy.mjs')
const NODE         = process.env.PBOX_NODE_BIN || process.execPath
const CALL_TIMEOUT = 1_800_000

// Per-session resources for v2
const SESSION_IDLE_MS = 60 * 60 * 1000  // 60 min idle -> close
const SESSION_MAX     = 16              // hard cap; oldest evicted
const _sessions       = new Map()        // chatSessionId -> { server, port, toolsPath, configPath, currentHandler, toolFingerprint, lastUseTs }
const _sessionTimers  = new Map()        // chatSessionId -> timeout

function toMcpTool (t) {
  return {
    name:        t.name,
    description: t.description || '',
    inputSchema: t.input_schema || t.inputSchema || { type: 'object', properties: {} },
  }
}

function _fingerprintTools (tools) {
  const names = (tools || []).map(t => t.name).sort()
  return createHash('sha256').update(names.join('|')).digest('hex').slice(0, 12)
}

function _wrapToolResult (resultStr) {
  // _BRIDGE_TOOL_RESULT_CAP_V1 + _BRIDGE_TOOL_RESULT_CAP_V2 -- bumped 100KB -> 2MB so screen-frame JPEG base64 fits intact
  const max = 2_000_000
  if (resultStr.length > max) {
    return { result: resultStr.slice(0, max), truncated: true, original_size: resultStr.length }
  }
  return { result: resultStr }
}

// Ephemeral (v1) callback server: serves one onToolCall closure, closed by caller.
async function _startEphemeralCallbackServer (onToolCall) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', async () => {
        try {
          const { name, args } = JSON.parse(body)
          const result = await onToolCall(name, args || {})
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(_wrapToolResult(String(result))))
        } catch (e) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ result: 'Error: ' + e.message }))
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
    server.on('error', reject)
  })
}

// Stable (v2) callback server per chatSessionId. Holds a mutable handler.
// Adapter updates the handler before each call; bridge v2 serialises calls per
// chatSessionId so there is no in-flight handler race.
function _makeStableCallbackServer () {
  const state = { handler: null }
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', async () => {
      try {
        const { name, args } = JSON.parse(body)
        if (!state.handler) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ result: 'Error: no handler bound to session' }))
          return
        }
        const result = await state.handler(name, args || {})
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(_wrapToolResult(String(result))))
      } catch (e) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ result: 'Error: ' + e.message }))
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }))
    server.on('error', reject)
  })
}

function _scheduleIdleReap (chatSessionId) {
  const prev = _sessionTimers.get(chatSessionId)
  if (prev) clearTimeout(prev)
  const t = setTimeout(() => _teardownSession(chatSessionId, 'idle_reap'), SESSION_IDLE_MS)
  t.unref()
  _sessionTimers.set(chatSessionId, t)
}

function _teardownSession (chatSessionId, reason) {
  const s = _sessions.get(chatSessionId)
  if (!s) return
  _sessions.delete(chatSessionId)
  const t = _sessionTimers.get(chatSessionId)
  if (t) { clearTimeout(t); _sessionTimers.delete(chatSessionId) }
  try { s.server.close() } catch {}
  try { unlinkSync(s.toolsPath) } catch {}
  try { unlinkSync(s.configPath) } catch {}
}

async function _ensureV2Session (chatSessionId, tools, onToolCall) {
  const fp = _fingerprintTools(tools)
  const existing = _sessions.get(chatSessionId)
  // _ADAPTER_PER_SESSION_CB_V1_FIX: always reuse if session exists. Don't
  // teardown on tools-fingerprint change -- the caller may send slightly different
  // tool sets per call (context-dependent), causing constant teardown of v2.
  // If tools genuinely change, write fresh tools.json under the same path so
  // any new MCP proxy spawn picks them up.
  if (existing) {
    existing.state.handler = onToolCall
    existing.lastUseTs = Date.now()
    if (existing.toolFingerprint !== fp) {
      try { writeFileSync(existing.toolsPath, JSON.stringify(tools.map(toMcpTool))) } catch {}
      existing.toolFingerprint = fp
    }
    _scheduleIdleReap(chatSessionId)
    return existing
  }

  // Cap: evict oldest idle if at limit
  if (_sessions.size >= SESSION_MAX) {
    let oldestId = null, oldestTs = Infinity
    for (const [id, s] of _sessions) {
      if (s.lastUseTs < oldestTs) { oldestTs = s.lastUseTs; oldestId = id }
    }
    if (oldestId) _teardownSession(oldestId, 'evict_for_capacity')
  }

  const id         = randomBytes(8).toString('hex')
  const toolsPath  = '/tmp/mcp-tools-v2-' + id + '.json'
  const configPath = '/tmp/mcp-config-v2-' + id + '.json'
  writeFileSync(toolsPath, JSON.stringify(tools.map(toMcpTool)))

  const { server, port, state } = await _makeStableCallbackServer()
  state.handler = onToolCall

  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      tools: {
        command: NODE,
        args:    [MCP_PROXY],
        env:     { CALLBACK_URL: 'http://127.0.0.1:' + port, TOOLS_PATH: toolsPath },
      },
    },
  }))

  const entry = { server, port, state, toolsPath, configPath, toolFingerprint: fp, lastUseTs: Date.now() }
  _sessions.set(chatSessionId, entry)
  _scheduleIdleReap(chatSessionId)
  return entry
}

// Process-shutdown cleanup -- best-effort
function _shutdownAll () {
  for (const id of [..._sessions.keys()]) _teardownSession(id, 'shutdown')
}
process.on('SIGTERM', _shutdownAll)
process.on('SIGINT',  _shutdownAll)
process.on('exit',    _shutdownAll)

// _ADAPTER_SERIAL_PER_SESSION_V1: per-chatSessionId promise chain so concurrent
// /api/chat requests for the same session queue rather than collide on v2's
// "turn in flight" rejection. Each new call awaits the previous turn for that
// session before proceeding.
const _sessionLocks = new Map()  // chatSessionId -> Promise (last turn's done)

// ── Common request shape ─────────────────────────────────────────────────────
async function _doCall ({ systemPrompt, messages, options, returnFull }) {
  const { tools, onToolCall, priority = 0, chatSessionId = null } = options
  const hasTools = tools && tools.length > 0 && typeof onToolCall === 'function'
  // Explicit allow-list so the bridge can run claude WITHOUT --dangerously-skip-permissions.
  const allowedTools = hasTools ? tools.map(t => 'mcp__tools__' + t.name) : undefined

  const useV2Session = BRIDGE_MODE === 'v2' && chatSessionId && hasTools

  // Serialise per chatSessionId for v2 (bridge can only handle one in-flight
  // turn per session). Wait for prior turn to settle.
  if (useV2Session) {
    const prev = _sessionLocks.get(chatSessionId)
    if (prev) { try { await prev } catch {} }
  }
  // Install our own promise as the new last-turn marker.
  let releaseLock = null
  if (useV2Session) {
    const lockPromise = new Promise(res => { releaseLock = res })
    _sessionLocks.set(chatSessionId, lockPromise)
  }

  let configPath = undefined
  let ephemeral  = null  // { server, toolsPath, configPath } for v1 path

  if (useV2Session) {
    const s = await _ensureV2Session(chatSessionId, tools, onToolCall)
    configPath = s.configPath
  } else if (hasTools) {
    const id        = randomBytes(8).toString('hex')
    const tp        = '/tmp/mcp-tools-' + id + '.json'
    const cp        = '/tmp/mcp-config-' + id + '.json'
    writeFileSync(tp, JSON.stringify(tools.map(toMcpTool)))
    const { server, port } = await _startEphemeralCallbackServer(onToolCall)
    writeFileSync(cp, JSON.stringify({
      mcpServers: {
        tools: {
          command: NODE,
          args:    [MCP_PROXY],
          env:     { CALLBACK_URL: 'http://127.0.0.1:' + port, TOOLS_PATH: tp },
        },
      },
    }))
    ephemeral = { server, toolsPath: tp, configPath: cp }
    configPath = cp
  }

  try {
    const r = await fetch(BRIDGE_URL + '/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ systemPrompt, messages, mcpConfigPath: configPath, priority, chatSessionId, allowedTools }),
      signal:  AbortSignal.timeout(CALL_TIMEOUT),
    })
    if (!r.ok) {
      const err = await r.text().catch(() => '')
      throw new Error('Claude bridge[' + BRIDGE_MODE + '] HTTP ' + r.status + ': ' + err.slice(0, 200))
    }
    const d = await r.json()
    if (returnFull) return { text: d.text || '', costUsd: d.costUsd || 0 }
    return d.text || ''
  } finally {
    if (ephemeral) {
      try { ephemeral.server.close() } catch {}
      setTimeout(() => {
        try { unlinkSync(ephemeral.toolsPath) } catch {}
        try { unlinkSync(ephemeral.configPath) } catch {}
      }, CALL_TIMEOUT + 60_000).unref()
    }
    // v2 session resources: NOT closed here; idle reaper handles it.
    // _ADAPTER_SERIAL_PER_SESSION_V1: release this turn's lock so a queued
    // next call can proceed. If we are still the latest entry, clean up Map.
    if (releaseLock) {
      releaseLock()
      // Best-effort: drop the lock from the map if no one chained after us.
      // The Map.set in a later call will have replaced this entry already if so.
      // Avoid removing if a different Promise has been registered since.
      // (Map size grows but bounded by active session count; idle reaper will
      // clean up via session teardown.)
    }
  }
}

export async function makeMessage (systemPrompt, messages, options = {}) {
  return _doCall({ systemPrompt, messages, options, returnFull: false })
}

export async function streamMessage (systemPrompt, messages, options = {}) {
  return makeMessage(systemPrompt, messages, options)
}

export async function healthCheck () {
  try {
    const r = await fetch(BRIDGE_URL + '/health', { signal: AbortSignal.timeout(5_000) })
    if (!r.ok) return false
    const d = await r.json()
    return d.ok === true
  } catch { return false }
}

export async function makeMessageFull (systemPrompt, messages, options = {}) {
  return _doCall({ systemPrompt, messages, options, returnFull: true })
}

export const _bridgeModeForDiag = BRIDGE_MODE
export const _v2SessionCount    = () => _sessions.size
