// event-sample-dispatcher.mjs — T7 QIL event hook for agent-emitted markers.
// Subscribes to the QIL event substrate; on a matching marker, triggers an
// immediate out-of-band frame capture outside the normal 1 fps cadence.
// These event-samples are NOT deducted from the 100 frames/hour Gemini cap —
// they are tagged separately in Argus as 'event_sample' frames.
//
// Dependency: T7 QIL phase 8a substrate (qil-trace-store.mjs + event bus).
// If QIL substrate is unavailable, dispatcher logs a warning and is a no-op.

const DEFAULT_MARKER_TYPES = ['important_context', 'user_focus', 'decision_point']
const STALE_THRESHOLD_MS   = 2000   // pull immediate capture if buffer newest frame is >2s old

export class EventSampleDispatcher {
  // qilEventBus: the T7 QIL event bus instance (has .subscribe(types[], cb) method)
  // ringBuffer:  RingBuffer instance (to check staleness before requesting capture)
  // requestCapture: async fn({ url, reason }) — calls worker.capture_now
  // argusEmit:  function(eventClass, payload)
  // markerEventTypes: string[] of QIL marker types to subscribe to
  constructor ({ qilEventBus, ringBuffer, requestCapture, argusEmit, markerEventTypes }) {
    this._bus            = qilEventBus      || null
    this._buffer         = ringBuffer
    this._requestCapture = requestCapture
    this._argusEmit      = argusEmit        || (() => {})
    this._markerTypes    = markerEventTypes || DEFAULT_MARKER_TYPES
    this._active         = false
    this._unsub          = null
  }

  start () {
    if (this._active) return
    if (!this._bus) {
      this._argusEmit('qil_bus_unavailable', { module: 'live-stream-vision', note: 'T7 QIL not ready; event-sample disabled' })
      return
    }

    this._unsub = this._bus.subscribe(this._markerTypes, (event) => {
      this._onMarker(event)
    })
    this._active = true
  }

  stop () {
    if (!this._active) return
    if (typeof this._unsub === 'function') {
      try { this._unsub() } catch {}
    }
    this._active = false
    this._unsub  = null
  }

  async _onMarker (event) {
    const markerType = event?.type || 'unknown'
    const url        = event?.context?.url || ''

    // Determine capture strategy: if buffer has a fresh frame (<2s old), use it;
    // otherwise request an immediate capture from the worker.
    const ageMs = (this._buffer?.ageSeconds?.() ?? Infinity) * 1000
    const reason = `event_sample:${markerType}`

    if (ageMs <= STALE_THRESHOLD_MS) {
      // Use the latest ring buffer frame — pass it directly to the Gemini pipeline.
      // Provider.mjs handles this via the 'use_buffered' path.
      this._argusEmit('event_sample_buffered', {
        marker_type: markerType,
        buffer_age_ms: Math.round(ageMs),
        url,
      })
      // Signal provider via a synthetic event (provider subscribes to 'event_sample_ready')
      if (typeof this._requestCapture === 'function') {
        await this._requestCapture({ url, reason, useBuffered: true })
      }
    } else {
      // Request immediate worker capture
      this._argusEmit('event_sample_triggered', {
        marker_type: markerType,
        trigger: 'immediate_capture',
        url,
      })
      if (typeof this._requestCapture === 'function') {
        await this._requestCapture({ url, reason, useBuffered: false })
      }
    }
  }

  get isActive () { return this._active }
  get markerTypes () { return [...this._markerTypes] }
}
