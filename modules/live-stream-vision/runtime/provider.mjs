// provider.mjs — live-stream-vision Module entry point.
// Pbox v2 T8. Wires all subcomponents. Exposes tool surface to agent.
//
// Load path: module-loader.mjs reads manifest.yaml, calls new Provider(ctx).
// ctx: { agentId, saveMemoryFn, argusEmit, qilEventBus, getTabUrl, watchNotify }
//
// Tools exposed (match manifest.yaml provides.tools):
//   stream_subscribe    -- start a new session (Ian-initiated)
//   stream_unsubscribe  -- graceful stop
//   stream_status       -- read session state + budget
//   stream_kill         -- hard stop (direct hardStop() path)

import { RingBuffer }             from './ring-buffer.mjs'
import { GeminiVisionClient }     from './gemini-vision-client.mjs'
import { MemoryWriter }           from './memory-writer.mjs'
import { EventSampleDispatcher }  from './event-sample-dispatcher.mjs'
import { SessionController }      from './session-controller.mjs'
import { UrlBlocklist }           from './security/url-blocklist.mjs'
import { RoiValidator }           from './security/roi-validator.mjs'

const MODULE_DIR = import.meta.url.replace(/\/provider\.mjs$/, '').replace('file://', '')

export class Provider {
  constructor (ctx) {
    const { agentId, saveMemoryFn, argusEmit, qilEventBus, getTabUrl, watchNotify } = ctx

    if (!agentId)      throw new Error('live-stream-vision Provider: agentId required')
    if (!saveMemoryFn) throw new Error('live-stream-vision Provider: saveMemoryFn required')

    this._agentId     = agentId
    this._getTabUrl   = getTabUrl    || (() => '')
    this._watchNotify = watchNotify  || (() => {})
    this._argusEmit   = argusEmit    || (() => {})
    this._worker      = null         // FrameSamplerWorkerWrapper (browser-only)
    this._indicator   = null         // StreamIndicator (browser-only; injected by ui layer)

    const emit = this._argusEmit.bind(this)

    const buffer = new RingBuffer(60)

    const gemini = new GeminiVisionClient({
      agentId,
      argusEmit: emit,
      onBudgetAlert: ({ used, remaining, sessionId }) => {
        this._watchNotify({ type: 'budget_alert', frames_used: used, frames_remaining: remaining, session_id: sessionId })
      },
    })

    const memory = new MemoryWriter({ saveMemoryFn, argusEmit: emit })

    const controller = new SessionController({
      worker:          this._worker,
      ringBuffer:      buffer,
      geminiClient:    gemini,
      memoryWriter:    memory,
      eventDispatcher: null,    // set below after construction
      streamIndicator: this._indicator,
      argusEmit:       emit,
      onStatusChange:  (status) => {
        this._watchNotify({ type: 'stream_status', ...status })
      },
    })

    const dispatcher = new EventSampleDispatcher({
      qilEventBus,
      ringBuffer: buffer,
      argusEmit:  emit,
      requestCapture: async ({ url, reason, useBuffered }) => {
        if (useBuffered) {
          const latest = buffer.latest()
          if (latest) {
            await controller.onFrame({ ...latest, reason })
          }
        } else {
          // Trigger immediate out-of-band capture via worker
          if (this._worker) {
            this._worker.captureNow({ url: url || this._getTabUrl(), reason })
          }
        }
      },
    })

    // Back-patch dispatcher into controller
    controller._dispatcher = dispatcher

    this._buffer     = buffer
    this._gemini     = gemini
    this._controller = controller
    this._dispatcher = dispatcher

    // Wire worker URL-tick handler (set by attachWorker when browser is ready)
    this._pendingWorkerFrameCb = (msg) => this._onWorkerMessage(msg)
  }

  // Called by web-interface surface after page load to attach the Web Worker.
  // workerWrapper: { start, pause, resume, stop, hardStop, captureNow, onMessage }
  attachWorker (workerWrapper) {
    this._worker = workerWrapper
    this._controller._worker = workerWrapper
    workerWrapper.onMessage(this._pendingWorkerFrameCb)
  }

  // Called by stream-indicator.js after injection to register UI handle.
  attachIndicator (indicator) {
    this._indicator = indicator
    this._controller._indicator = indicator
  }

  async _onWorkerMessage (msg) {
    switch (msg.type) {
      case 'frame':
        await this._controller.onFrame(msg)
        break

      case 'frame_blocked':
        this._argusEmit('frame_blocked', {
          session_id: msg.sessionId,
          url:        msg.url,
          domain:     msg.domain,
        })
        break

      case 'request_url':
        // Worker is requesting the current tab URL for the next frame pre-flight.
        if (this._worker) {
          this._worker.send({ type: 'tick_url', url: this._getTabUrl() })
        }
        break

      case 'stopped':
        // Worker confirmed stop (e.g. user closed the screen share). Ensure session is stopped.
        if (this._controller.state !== 'stopped') {
          this._controller.hardStop('worker_ended')
        }
        break

      case 'error':
        this._argusEmit('worker_error', { message: msg.message })
        break

      default:
        break
    }
  }

  // ── Tool surface ─────────────────────────────────────────────────────────────

  // stream_subscribe: start a new session. config: { roi?, blocklist_extra? }
  async tool_stream_subscribe (config = {}) {
    if (this._controller.state !== 'idle') {
      return { error: 'A streaming session is already active. Call stream_kill first.' }
    }

    // Validate ROI if provided
    if (config.roi) {
      const roiCheck = RoiValidator.validate(config.roi, config.frame_dimensions || null)
      if (!roiCheck.ok) {
        this._argusEmit('roi_validation_failed', { reason: roiCheck.reason })
        config.roi = null   // fall back to full frame
      }
    }

    await this._controller.start({
      agentId:   this._agentId,
      roi:       config.roi || null,
      blocklist: UrlBlocklist.compile(config.blocklist_extra || []),
    })

    this._watchNotify({
      type:       'stream_started',
      session_id: this._controller.sessionId,
      quick_action: 'Kill stream',
      quick_action_endpoint: 'POST /watchmuse/stream-kill',
    })

    return { ok: true, session_id: this._controller.sessionId, state: this._controller.state }
  }

  // stream_unsubscribe: graceful stop
  tool_stream_unsubscribe () {
    try {
      this._controller.stop()
      return { ok: true, state: this._controller.state }
    } catch (e) {
      return { error: e.message }
    }
  }

  // stream_status: read-only status
  tool_stream_status () {
    return { ok: true, ...this._controller.status }
  }

  // stream_kill: hard stop (agent-callable alias; same path as WatchMuse endpoint)
  tool_stream_kill () {
    this._controller.hardStop('tool_stream_kill')
    return { ok: true, state: 'stopped', session_id: this._controller.sessionId }
  }

  // Called on module unload or conductor restart — ensures stream is always killed.
  destroy () {
    this._controller.hardStop('module_unload')
  }
}
