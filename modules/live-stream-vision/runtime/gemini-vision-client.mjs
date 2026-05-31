// gemini-vision-client.mjs — Gemini 2.5 Flash multimodal REST client.
// Per-module API key: google_ai_api_key_vision (separate from ai-create's key).
// Rate limiter: token bucket, 100 frames/hour. Alert callback at 80 frames.
// All callers pass an argusEmit function for event class reporting.

import { loadCred } from '${PBOX_SHARED}/module-cred-scope.mjs'

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const MODULE_ID       = 'live-stream-vision'
const CRED_NAME       = 'google_ai_api_key_vision'
const FRAMES_PER_HOUR = 100
const BUDGET_ALERT_AT = 80

const OBSERVE_PROMPT = 'Describe what is visible on screen, focusing on task context and any notable content. Be concise. Do not describe UI chrome unless it is central to the task context.'

// ── Token bucket rate limiter ──────────────────────────────────────────────────

class TokenBucket {
  constructor (capacity, refillPerHour) {
    this._cap      = capacity
    this._tokens   = capacity
    this._refillMs = 3_600_000 / refillPerHour   // ms per token refill
    this._lastTick = Date.now()
    this._used     = 0          // total consumed in current window
    this._windowStart = Date.now()
  }

  _refill () {
    const now = Date.now()
    const elapsed = now - this._lastTick
    const newTokens = Math.floor(elapsed / this._refillMs)
    if (newTokens > 0) {
      this._tokens = Math.min(this._cap, this._tokens + newTokens)
      this._lastTick += newTokens * this._refillMs
    }
    // Reset hourly counter on new window
    if (now - this._windowStart >= 3_600_000) {
      this._used = 0
      this._windowStart = now
    }
  }

  // Returns { ok: boolean, used: number, remaining: number }
  consume () {
    this._refill()
    if (this._tokens <= 0) {
      return { ok: false, used: this._used, remaining: 0 }
    }
    this._tokens--
    this._used++
    return { ok: true, used: this._used, remaining: this._tokens }
  }

  get used () {
    this._refill()
    return this._used
  }

  get remaining () {
    this._refill()
    return this._tokens
  }
}

// ── Client ─────────────────────────────────────────────────────────────────────

export class GeminiVisionClient {
  constructor ({ agentId, argusEmit, onBudgetAlert }) {
    if (!agentId) throw new Error('GeminiVisionClient: agentId required')
    this._agentId      = agentId
    this._argusEmit    = argusEmit    || (() => {})
    this._onBudgetAlert = onBudgetAlert || (() => {})
    this._bucket       = new TokenBucket(FRAMES_PER_HOUR, FRAMES_PER_HOUR)
    this._alertFired   = false
    this._apiKey       = null   // loaded lazily
  }

  _getApiKey () {
    if (!this._apiKey) {
      // loadCred enforces per-agent scoping (R3) and refuses cross-agent reads.
      this._apiKey = loadCred(this._agentId, MODULE_ID, CRED_NAME)
    }
    return this._apiKey
  }

  // Analyse a single JPEG frame (base64). Returns { observation, confidence, raw } or throws.
  async analyse ({ frame, url, roi, sessionId, frameNumber, reason }) {
    if (typeof frame !== 'string' || !frame.length) throw new Error('analyse: frame must be non-empty base64')

    // Rate limit check
    const tick = this._bucket.consume()
    if (!tick.ok) {
      this._argusEmit('frame_rate_limited', {
        session_id: sessionId,
        frames_used: tick.used,
        reason: 'token bucket exhausted',
      })
      throw new Error('GeminiVisionClient: rate limit exceeded (100 frames/hour)')
    }

    // Budget alert at 80 frames
    if (!this._alertFired && tick.used >= BUDGET_ALERT_AT) {
      this._alertFired = true
      this._argusEmit('budget_alert', {
        session_id: sessionId,
        frames_used: tick.used,
        remaining: tick.remaining,
      })
      this._onBudgetAlert({ used: tick.used, remaining: tick.remaining, sessionId })
    }

    const key = this._getApiKey()
    const reqUrl = `${GEMINI_ENDPOINT}?key=${key}`

    const body = {
      contents: [{
        parts: [
          { text: OBSERVE_PROMPT },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data:      frame,
            },
          },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 512,
        temperature:     0.1,
      },
    }

    const res = await fetch(reqUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Gemini Vision HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const confidence = data?.candidates?.[0]?.finishReason === 'STOP' ? 'high' : 'low'

    return {
      observation: text,
      confidence,
      frameNumber: frameNumber ?? null,
      framesUsed: tick.used,
      framesRemaining: tick.remaining,
      reason: reason || 'scheduled',
    }
  }

  get framesUsed () { return this._bucket.used }
  get framesRemaining () { return this._bucket.remaining }
}
