// memory-writer.mjs — write Gemini observations to the agent's memory Store.
// Calls save_memory() with retention metadata. Never writes raw JPEG frames.
// On failure: logs Argus memory_write_failed event; continues session.

const RETENTION_DAYS  = 7
const SOURCE_TAG      = 'live-stream-vision'

function _retentionExpires () {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + RETENTION_DAYS)
  return d.toISOString()
}

export class MemoryWriter {
  // saveMemoryFn: the agent's save_memory() tool callable; accepts (content, metadata).
  // argusEmit: function(eventClass, payload) for Argus reporting.
  constructor ({ saveMemoryFn, argusEmit }) {
    if (typeof saveMemoryFn !== 'function') throw new Error('MemoryWriter: saveMemoryFn required')
    this._save      = saveMemoryFn
    this._argusEmit = argusEmit || (() => {})
  }

  // Write one observation to memory. Returns { ok, memory_id? }.
  async write ({ observation, confidence, sessionId, frameTimestamp, url, roiRegion, frameNumber, framesUsed }) {
    if (!observation || typeof observation !== 'string') {
      throw new Error('MemoryWriter.write: observation must be a non-empty string')
    }

    // Sanitise URL: strip query params + fragment to reduce sensitive data in memory
    let safeUrl = url || ''
    try {
      const u = new URL(safeUrl)
      safeUrl = u.origin + u.pathname   // domain + path only, no query/fragment
    } catch { /* not a valid URL, use as-is */ }

    const content = [
      `[Live Stream Observation — ${new Date(frameTimestamp || Date.now()).toUTCString()}]`,
      `URL: ${safeUrl}`,
      '',
      observation,
    ].join('\n')

    const metadata = {
      source:            SOURCE_TAG,
      stream_id:         sessionId   || null,
      frame_timestamp:   frameTimestamp || new Date().toISOString(),
      url:               safeUrl,
      roi_region:        roiRegion   || null,
      gemini_response:   observation,
      confidence:        confidence  || 'unknown',
      frame_number:      frameNumber ?? null,
      frames_used_this_hour: framesUsed ?? null,
      retention_expires: _retentionExpires(),
      urania_audit:      true,
    }

    try {
      const result = await this._save(content, metadata)
      return { ok: true, memory_id: result?.id || null }
    } catch (e) {
      this._argusEmit('memory_write_failed', {
        session_id:    sessionId,
        frame_timestamp: frameTimestamp,
        error:         e.message,
      })
      return { ok: false, error: e.message }
    }
  }
}
