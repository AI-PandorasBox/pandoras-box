#!/usr/bin/env node
/**
 * pbox-voice-call -- per-tenant real-time voice call orchestrator (v0.5.x)
 *
 * Persistent daemon, NOT a job poller. Bridges a browser-default loopback
 * audio session to Gemini Live (bidirectional PCM streaming) so an operator
 * can hold a real-time voice conversation with the agent.
 *
 * Architecture:
 *   browser  <-- HTTP + WSS -->  pbox-voice-call (this)  <-- WSS -->  Gemini Live
 *
 * The HTTP surface serves the operator UI at 127.0.0.1:${PORT}/.
 * The WSS surface accepts PCM 16kHz mono from the browser and emits PCM
 * 24kHz mono back. Internally the Gemini Live adapter handles the audio
 * format translation + speech-recognition + voice synthesis.
 *
 * v0.5.x scope: conversation-only. Tool dispatch during a call is NOT
 * available -- the conductor's jobs.db IPC is async and would jar the
 * call UX. v0.6 will add a synchronous conductor API + in-call tool
 * routing.
 *
 * Per-tenant config:
 *   <tenant>/.env:
 *     GOOGLE_API_KEY=...        (required; enables the Live API connection)
 *     VOICE_CALL_PORT=8800      (optional; default per per-install random offset)
 *     VOICE_CALL_MODEL=models/gemini-2.0-flash-exp  (optional)
 *     VOICE_CALL_VOICE=Aoede    (optional; one of Aoede / Charon / Fenrir / Kore / Puck)
 *     VOICE_CALL_SYSTEM=...     (optional; system prompt to seed each call)
 *
 *   <tenant>/store/voice-call-config.json:
 *     { "system_prompt": "...", "voice": "Aoede", "model": "..." }
 *
 * Cost tracking:
 *   <tenant>/store/voice-call-cost.jsonl -- one line per session with
 *   audio_seconds_in, audio_seconds_out, est_cost_usd.
 */

import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// ── Env-driven config ─────────────────────────────────────────────────────────

const COMPANY_SLUG = process.env.COMPANY_SLUG
const INSTALL_PATH = process.env.INSTALL_PATH

if (!COMPANY_SLUG || !INSTALL_PATH) {
  console.error('[pbox-voice-call] FATAL: COMPANY_SLUG and INSTALL_PATH must be set in env')
  process.exit(1)
}

const SERVICE_NAME  = `${COMPANY_SLUG}-voice-call`
const TENANT_ROOT   = `${INSTALL_PATH}/${COMPANY_SLUG}`
const STORE_DIR     = `${TENANT_ROOT}/store`
const LOGS_DIR      = `${TENANT_ROOT}/logs`
const AUDIT_LOG     = `${LOGS_DIR}/audit.log`
const COST_LOG      = `${STORE_DIR}/voice-call-cost.jsonl`
const CONFIG_FILE   = `${STORE_DIR}/voice-call-config.json`
const PUBLIC_DIR    = `${INSTALL_PATH}/${SERVICE_NAME}/public`

const GOOGLE_API_KEY  = process.env.GOOGLE_API_KEY
const PORT            = Number(process.env.VOICE_CALL_PORT ?? 8800)
const HTTP_BIND       = process.env.VOICE_CALL_BIND ?? '127.0.0.1'
const MODEL           = process.env.VOICE_CALL_MODEL ?? 'models/gemini-2.0-flash-exp'
const VOICE           = process.env.VOICE_CALL_VOICE ?? 'Aoede'
const SYSTEM_PROMPT   = process.env.VOICE_CALL_SYSTEM ?? null
const MAX_CALL_SECS   = Number(process.env.VOICE_CALL_MAX_SECONDS ?? 3600)

const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'

// ── Logging + audit ──────────────────────────────────────────────────────────

function log (msg) {
  console.log(`[${new Date().toISOString()}] [${SERVICE_NAME}] ${msg}`)
}

function auditWrite (event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: SERVICE_NAME,
    slug: COMPANY_SLUG,
    task_type: 'voice_call',
    ...event,
  }) + '\n'
  try {
    if (!existsSync(dirname(AUDIT_LOG))) mkdirSync(dirname(AUDIT_LOG), { recursive: true })
    appendFileSync(AUDIT_LOG, line)
  } catch {}
}

function loadConfig () {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

// ── Gemini Live cost estimator ────────────────────────────────────────────────
//
// Gemini Live 2.0 Flash pricing (as of late 2025, audio input/output billed
// per second). Operators are responsible for confirming the live tariff; this
// daemon only records SECONDS streamed so the operator can compute exact cost
// from current rates.
const COST_RATE = {
  audio_in_per_sec:  0.000150,
  audio_out_per_sec: 0.000600,
}

function logCallCost (sessionId, audioInSecs, audioOutSecs) {
  const estUsd =
    audioInSecs  * COST_RATE.audio_in_per_sec +
    audioOutSecs * COST_RATE.audio_out_per_sec
  const entry = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    slug: COMPANY_SLUG,
    audio_seconds_in:  Number(audioInSecs.toFixed(2)),
    audio_seconds_out: Number(audioOutSecs.toFixed(2)),
    est_cost_usd:      Number(estUsd.toFixed(6)),
    rate_card_version: '2025-q4',
  }
  try {
    if (!existsSync(dirname(COST_LOG))) mkdirSync(dirname(COST_LOG), { recursive: true })
    appendFileSync(COST_LOG, JSON.stringify(entry) + '\n')
  } catch {}
  return entry
}

// ── HTTP server (static UI + health) ──────────────────────────────────────────

function serveStatic (req, res) {
  const url = new URL(req.url, `http://${HTTP_BIND}:${PORT}`)
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname

  // Health endpoint
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, slug: COMPANY_SLUG, model: MODEL, voice: VOICE }))
    return
  }

  // Config snapshot (no secrets)
  if (pathname === '/config') {
    const cfg = loadConfig()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      slug:   COMPANY_SLUG,
      model:  cfg.model  ?? MODEL,
      voice:  cfg.voice  ?? VOICE,
      has_system_prompt: !!(cfg.system_prompt ?? SYSTEM_PROMPT),
      max_call_seconds:  MAX_CALL_SECS,
    }))
    return
  }

  // Loopback-only guard for static file serving.
  const remote = (req.socket?.remoteAddress ?? '').toString()
  if (!remote.startsWith('127.') && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    res.writeHead(403); res.end('loopback only'); return
  }

  // Static files under PUBLIC_DIR.
  const cleanPath = pathname.replace(/\.\.+/g, '').replace(/[^A-Za-z0-9_\-./]/g, '')
  const filePath  = `${PUBLIC_DIR}${cleanPath}`
  try {
    const body = readFileSync(filePath)
    const ext  = filePath.split('.').pop()
    const mime =
      ext === 'html' ? 'text/html; charset=utf-8' :
      ext === 'js'   ? 'application/javascript; charset=utf-8' :
      ext === 'css'  ? 'text/css; charset=utf-8' :
      ext === 'json' ? 'application/json' :
                       'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('not found')
  }
}

// ── Session ───────────────────────────────────────────────────────────────────

class CallSession {
  constructor (browserWs) {
    this.id           = `vc-${Date.now()}-${randomUUID().slice(0, 8)}`
    this.browser      = browserWs
    this.gemini       = null
    this.startedAt    = Date.now()
    this.audioInBytes = 0    // PCM 16k mono from browser
    this.audioOutBytes = 0   // PCM 24k mono to browser
    this.closed       = false
    this.killTimer    = null
  }

  audioInSeconds  () { return this.audioInBytes  / (16000 * 2) }   // 16 kHz × 16-bit
  audioOutSeconds () { return this.audioOutBytes / (24000 * 2) }   // 24 kHz × 16-bit

  scheduleHardCap () {
    this.killTimer = setTimeout(() => {
      log(`[${this.id}] hard cap ${MAX_CALL_SECS}s reached, closing`)
      this.close('max_call_seconds')
    }, MAX_CALL_SECS * 1000)
  }

  close (reason) {
    if (this.closed) return
    this.closed = true
    if (this.killTimer) clearTimeout(this.killTimer)
    const cost = logCallCost(this.id, this.audioInSeconds(), this.audioOutSeconds())
    auditWrite({
      event: 'call_ended', session_id: this.id, reason,
      seconds: ((Date.now() - this.startedAt) / 1000).toFixed(1),
      cost,
    })
    log(`[${this.id}] closed (${reason}). cost est $${cost.est_cost_usd}`)
    try { this.gemini?.close()  } catch {}
    try { this.browser?.close() } catch {}
  }
}

// ── Gemini Live bridge ────────────────────────────────────────────────────────

function openGeminiLive (session, cfg) {
  if (!GOOGLE_API_KEY) {
    session.browser.send(JSON.stringify({ type: 'error', error: 'GOOGLE_API_KEY not configured for this tenant' }))
    session.close('no_api_key')
    return
  }

  const url = `${GEMINI_LIVE_URL}?key=${encodeURIComponent(GOOGLE_API_KEY)}`
  const ws  = new WebSocket(url)
  session.gemini = ws

  ws.on('open', () => {
    const systemPrompt = cfg.system_prompt ?? SYSTEM_PROMPT ?? null
    const setup = {
      setup: {
        model: cfg.model ?? MODEL,
        generation_config: {
          response_modalities: ['AUDIO'],
          speech_config: { voice_config: { prebuilt_voice_config: { voice_name: cfg.voice ?? VOICE } } },
        },
        ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
      },
    }
    ws.send(JSON.stringify(setup))
    auditWrite({ event: 'gemini_live_setup', session_id: session.id, model: cfg.model ?? MODEL, voice: cfg.voice ?? VOICE })
    session.browser.send(JSON.stringify({ type: 'ready', session_id: session.id }))
  })

  ws.on('message', (data) => {
    let parsed
    try { parsed = JSON.parse(data.toString()) } catch { return }
    // Audio chunks from Gemini are base64-encoded PCM 24k mono inside
    // serverContent.modelTurn.parts[].inlineData.data
    const parts = parsed?.serverContent?.modelTurn?.parts ?? []
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data
      if (inline?.mimeType?.startsWith('audio/') && inline.data) {
        const pcm = Buffer.from(inline.data, 'base64')
        session.audioOutBytes += pcm.length
        if (session.browser.readyState === WebSocket.OPEN) {
          session.browser.send(pcm, { binary: true })
        }
      }
      if (part.text) {
        session.browser.send(JSON.stringify({ type: 'transcript', role: 'model', text: part.text }))
      }
    }
    if (parsed?.serverContent?.turnComplete) {
      session.browser.send(JSON.stringify({ type: 'turn_complete' }))
    }
  })

  ws.on('error', (err) => {
    log(`[${session.id}] gemini error: ${err.message}`)
    auditWrite({ event: 'gemini_error', session_id: session.id, error: err.message })
    try { session.browser.send(JSON.stringify({ type: 'error', error: 'gemini_live_error' })) } catch {}
  })

  ws.on('close', (code, reason) => {
    log(`[${session.id}] gemini closed: code=${code} reason=${reason?.toString()?.slice(0, 100)}`)
    auditWrite({ event: 'gemini_closed', session_id: session.id, code })
    session.close('gemini_closed')
  })
}

// ── WSS server ────────────────────────────────────────────────────────────────

function startWss (httpServer) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, sock, head) => {
    const remote = (sock.remoteAddress ?? '').toString()
    if (!remote.startsWith('127.') && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      sock.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      sock.destroy()
      return
    }
    const url = new URL(req.url, `http://${HTTP_BIND}:${PORT}`)
    if (url.pathname !== '/call/ws') {
      sock.write('HTTP/1.1 404 Not Found\r\n\r\n')
      sock.destroy()
      return
    }
    wss.handleUpgrade(req, sock, head, (browserWs) => {
      const session = new CallSession(browserWs)
      const cfg     = loadConfig()
      log(`[${session.id}] browser connected`)
      auditWrite({ event: 'call_started', session_id: session.id })
      session.scheduleHardCap()
      openGeminiLive(session, cfg)

      browserWs.on('message', (data, isBinary) => {
        if (isBinary) {
          // PCM 16k mono from browser; forward to Gemini as base64
          session.audioInBytes += data.length
          if (session.gemini?.readyState === WebSocket.OPEN) {
            session.gemini.send(JSON.stringify({
              realtime_input: {
                media_chunks: [{ mime_type: 'audio/pcm;rate=16000', data: data.toString('base64') }],
              },
            }))
          }
          return
        }
        // JSON control messages
        let msg
        try { msg = JSON.parse(data.toString()) } catch { return }
        if (msg.type === 'end_call') session.close('browser_ended')
        if (msg.type === 'text_input' && msg.text && session.gemini?.readyState === WebSocket.OPEN) {
          session.gemini.send(JSON.stringify({
            client_content: {
              turns: [{ role: 'user', parts: [{ text: msg.text }] }],
              turn_complete: true,
            },
          }))
        }
      })

      browserWs.on('close',  () => session.close('browser_disconnected'))
      browserWs.on('error',  () => session.close('browser_error'))
    })
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!GOOGLE_API_KEY) {
  log('GOOGLE_API_KEY not set in .env -- daemon will start but every call will refuse.')
}

const server = createServer(serveStatic)
startWss(server)

server.listen(PORT, HTTP_BIND, () => {
  log(`Listening on http://${HTTP_BIND}:${PORT}  (tenant=${COMPANY_SLUG}, model=${MODEL}, voice=${VOICE})`)
  auditWrite({ event: 'service_started', port: PORT, model: MODEL, voice: VOICE, max_call_seconds: MAX_CALL_SECS })
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`Received ${sig} -- shutting down.`)
    auditWrite({ event: 'service_stopped', signal: sig })
    try { server.close() } catch {}
    process.exit(0)
  })
}
