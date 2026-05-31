// session-controller.mjs — state machine for live-stream-vision sessions.
//
// States: idle -> active -> paused -> stopped
//
// Key guarantees:
//  - Initial state is always 'idle'. No auto-start code path.
//  - hardStop() transitions directly to 'stopped' regardless of current state.
//    It calls worker stop, destroys the buffer, removes UI indicator, and emits
//    Argus stream_kill — with no hooks or interceptors in the path.
//  - Session ID is a UUID generated fresh on each idle->active transition.
//  - No state persists between page loads (all in-memory).

import { randomUUID } from 'node:crypto'

// In browser context, randomUUID may come from crypto.randomUUID()
function genUUID () {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  try { return randomUUID() } catch { return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

const VALID_TRANSITIONS = {
  idle:    ['active'],
  active:  ['paused', 'stopped'],
  paused:  ['active', 'stopped'],
  stopped: [],
}

export class SessionController {
  constructor ({ worker, ringBuffer, geminiClient, memoryWriter, eventDispatcher, streamIndicator, argusEmit, onStatusChange }) {
    this._worker          = worker          // FrameSampler worker wrapper
    this._buffer          = ringBuffer
    this._gemini          = geminiClient
    this._memory          = memoryWriter
    this._dispatcher      = eventDispatcher
    this._indicator       = streamIndicator // StreamIndicator UI instance
    this._argusEmit       = argusEmit       || (() => {})
    this._onStatusChange  = onStatusChange  || (() => {})
    this._state           = 'idle'
    this._sessionId       = null
    this._startedAt       = null
    this._frameCount      = 0
  }

  get state ()     { return this._state }
  get sessionId () { return this._sessionId }

  get status () {
    return {
      state:      this._state,
      session_id: this._sessionId,
      started_at: this._startedAt,
      frame_count: this._frameCount,
      frames_used_this_hour: this._gemini?.framesUsed ?? 0,
      frames_remaining:      this._gemini?.framesRemaining ?? 100,
    }
  }

  _assertTransition (target) {
    if (!VALID_TRANSITIONS[this._state]?.includes(target)) {
      throw new Error(`SessionController: cannot transition from '${this._state}' to '${target}'`)
    }
  }

  _setState (s) {
    this._state = s
    this._onStatusChange(this.status)
  }

  // Ian-initiated: idle -> active
  async start (config = {}) {
    this._assertTransition('active')

    this._sessionId  = genUUID()
    this._startedAt  = new Date().toISOString()
    this._frameCount = 0

    this._argusEmit('stream_subscribe', {
      session_id: this._sessionId,
      agent:      config.agentId || 'unknown',
      timestamp:  this._startedAt,
    })

    // Start sampler worker
    if (this._worker) await this._worker.start({ ...config, sessionId: this._sessionId })

    // Start event dispatcher (QIL hook)
    if (this._dispatcher) this._dispatcher.start()

    // Show streaming indicator (red)
    if (this._indicator) this._indicator.setActive()

    this._setState('active')
  }

  // active -> paused
  pause () {
    this._assertTransition('paused')
    if (this._worker) this._worker.pause()
    if (this._dispatcher) this._dispatcher.stop()
    if (this._indicator) this._indicator.setPaused()
    this._setState('paused')
  }

  // paused -> active
  resume () {
    this._assertTransition('active')
    if (this._worker) this._worker.resume()
    if (this._dispatcher) this._dispatcher.start()
    if (this._indicator) this._indicator.setActive()
    this._setState('active')
  }

  // Graceful stop (agent-accessible): active|paused -> stopped
  stop () {
    this._assertTransition('stopped')
    this._doStop('graceful')
  }

  // HARD KILL — no hooks, no interceptors, no async, no agent code in path.
  // Called by: UI kill button, POST /watchmuse/stream-kill, launchctl stop (via provider destroy).
  // Safe to call from any state including 'idle'.
  hardStop (triggeredBy = 'unknown') {
    const wasState = this._state
    if (this._state === 'stopped') return   // idempotent

    // Direct stop — bypass all agent code paths
    this._state = 'stopped'   // set first so nothing re-enters

    // Worker: stop synchronously where possible
    try { if (this._worker) this._worker.hardStop() } catch {}

    // Event dispatcher off
    try { if (this._dispatcher) this._dispatcher.stop() } catch {}

    // Ring buffer wipe
    try { if (this._buffer) this._buffer.clear() } catch {}

    // Indicator hidden
    try { if (this._indicator) this._indicator.setHidden() } catch {}

    this._argusEmit('stream_kill', {
      session_id:   this._sessionId,
      triggered_by: triggeredBy,
      was_state:    wasState,
      frame_count:  this._frameCount,
    })

    this._onStatusChange(this.status)
  }

  _doStop (reason) {
    if (this._worker) this._worker.stop()
    if (this._dispatcher) this._dispatcher.stop()
    if (this._buffer) this._buffer.clear()
    if (this._indicator) this._indicator.setHidden()

    this._argusEmit('stream_kill', {
      session_id:   this._sessionId,
      triggered_by: reason,
      was_state:    this._state,
      frame_count:  this._frameCount,
    })

    this._setState('stopped')
  }

  // Called by provider when a new frame arrives from the worker.
  // Handles: ring buffer push, Gemini call, memory write.
  async onFrame ({ frame, timestamp, url, roi, sessionId, reason }) {
    if (this._state !== 'active') return
    if (sessionId !== this._sessionId) return   // stale frame from previous session

    this._frameCount++

    // Push to ring buffer
    if (this._buffer) this._buffer.push({ frame, timestamp, url, roi })

    // Gemini analyse
    let result
    try {
      result = await this._gemini.analyse({
        frame, url, roi,
        sessionId,
        frameNumber: this._frameCount,
        reason,
      })
    } catch (e) {
      // Rate limit or network error — Gemini client already emitted Argus event
      return
    }

    this._argusEmit('frame_sample', {
      session_id:    sessionId,
      frame_number:  this._frameCount,
      url_domain:    (() => { try { return new URL(url).hostname } catch { return url } })(),
      response_len:  result.observation?.length ?? 0,
      frames_used:   result.framesUsed,
      is_event_sample: (reason || '').startsWith('event_sample'),
    })

    // Memory write
    await this._memory.write({
      observation:   result.observation,
      confidence:    result.confidence,
      sessionId,
      frameTimestamp: timestamp,
      url,
      roiRegion:     roi,
      frameNumber:   this._frameCount,
      framesUsed:    result.framesUsed,
    })
  }
}
