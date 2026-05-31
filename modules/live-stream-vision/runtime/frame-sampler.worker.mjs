// frame-sampler.worker.mjs — Web Worker: getDisplayMedia + 1 fps JPEG capture.
//
// Runs inside a browser Web Worker. Communicates with provider.mjs via postMessage.
//
// Messages received (from main thread):
//   { type: 'start',  config: { roi, blocklist, sessionId } }
//   { type: 'pause' }
//   { type: 'resume' }
//   { type: 'stop' }
//   { type: 'capture_now', reason: string }  -- immediate out-of-band capture for event-sample
//
// Messages posted (to main thread):
//   { type: 'frame',         frame: base64, timestamp, url, roi, sessionId }
//   { type: 'frame_blocked', url, domain, sessionId }
//   { type: 'error',         message }
//   { type: 'stopped' }

'use strict'

// ── State ──────────────────────────────────────────────────────────────────────

let _stream   = null   // MediaStream from getDisplayMedia
let _track    = null   // VideoTrack
let _canvas   = null
let _ctx2d    = null
let _interval = null
let _state    = 'idle'      // idle | active | paused | stopped
let _config   = {}
let _sessionId = null

// ── URL blocklist check ────────────────────────────────────────────────────────
// The worker does not have access to document.location; the main thread injects
// the current URL via the config before each frame emission cycle. See _capture().

function _isBlocked (url, blocklist) {
  if (!url || !Array.isArray(blocklist) || blocklist.length === 0) return false
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()
    for (const pattern of blocklist) {
      const p = (pattern || '').toLowerCase()
      // Glob-style hostname match: *.example.com or exact
      if (p.startsWith('*.')) {
        const suffix = p.slice(2)
        if (hostname === suffix || hostname.endsWith('.' + suffix)) return true
      } else if (p.includes('/')) {
        // hostname + path pattern
        const [phostname, ...ppath] = p.split('/')
        const ppathStr = ppath.join('/')
        const hostMatch = hostname === phostname || hostname.endsWith('.' + phostname)
        const pathMatch = pathname.includes(ppathStr)
        if (hostMatch && pathMatch) return true
      } else {
        if (hostname === p || hostname.endsWith('.' + p)) return true
      }
    }
  } catch { return false }
  return false
}

// ── ROI crop ──────────────────────────────────────────────────────────────────

function _applyRoi (srcCanvas, roi) {
  // roi: { top, left, width, height } in px, or null for full frame
  if (!roi) return srcCanvas
  const dst = new OffscreenCanvas(roi.width, roi.height)
  const dctx = dst.getContext('2d')
  dctx.drawImage(srcCanvas, roi.left, roi.top, roi.width, roi.height, 0, 0, roi.width, roi.height)
  return dst
}

// ── Capture ───────────────────────────────────────────────────────────────────

async function _capture (currentUrl, reason) {
  if (_state !== 'active') return
  if (!_track || _track.readyState !== 'live') {
    self.postMessage({ type: 'error', message: 'video track lost' })
    return
  }

  const blocklist = _config.blocklist || []

  // URL blocklist pre-flight
  if (_isBlocked(currentUrl, blocklist)) {
    self.postMessage({
      type:      'frame_blocked',
      url:       currentUrl,
      domain:    (() => { try { return new URL(currentUrl).hostname } catch { return currentUrl } })(),
      sessionId: _sessionId,
      reason:    reason || 'scheduled',
    })
    return
  }

  // Capture from video track via ImageCapture API
  let imageBitmap
  try {
    const ic = new ImageCapture(_track)
    imageBitmap = await ic.grabFrame()
  } catch {
    // Fallback: draw to canvas via drawImage on a video element approach.
    // Workers can't create <video>; if ImageCapture fails, we skip this frame.
    self.postMessage({ type: 'error', message: 'ImageCapture.grabFrame failed — frame skipped' })
    return
  }

  // Draw to OffscreenCanvas for encoding
  if (!_canvas || _canvas.width !== imageBitmap.width || _canvas.height !== imageBitmap.height) {
    _canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
    _ctx2d  = _canvas.getContext('2d')
  }
  _ctx2d.drawImage(imageBitmap, 0, 0)
  imageBitmap.close()

  // Apply ROI crop if configured
  const roiCanvas = _applyRoi(_canvas, _config.roi || null)

  // Encode to JPEG (0.7 quality)
  const blob = await roiCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
  const ab   = await blob.arrayBuffer()
  const b64  = btoa(String.fromCharCode(...new Uint8Array(ab)))

  self.postMessage({
    type:      'frame',
    frame:     b64,
    timestamp: new Date().toISOString(),
    url:       currentUrl,
    roi:       _config.roi || null,
    sessionId: _sessionId,
    reason:    reason || 'scheduled',
  })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function _start (config) {
  if (_state !== 'idle') return

  _config    = config || {}
  _sessionId = config.sessionId

  try {
    _stream = await self.navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 1, max: 1 } },
      audio: false,
    })
  } catch (e) {
    self.postMessage({ type: 'error', message: 'getDisplayMedia denied: ' + e.message })
    return
  }

  const tracks = _stream.getVideoTracks()
  if (!tracks.length) {
    self.postMessage({ type: 'error', message: 'no video tracks in display stream' })
    return
  }
  _track = tracks[0]

  // Honour track ending (user closes share)
  _track.addEventListener('ended', () => {
    _stop()
    self.postMessage({ type: 'error', message: 'display stream ended by user' })
  })

  _state = 'active'

  // Main thread provides current URL with each tick (we poll via message).
  // Use a 1000ms interval; URL is passed via capture_now or the tick message.
  // Here we request the main thread to start sending tick messages.
  self.postMessage({ type: 'ready', sessionId: _sessionId })

  // Self-ticking 1 fps loop — main thread will send tick messages with current URL.
  _interval = setInterval(() => {
    if (_state === 'active') {
      // Request a URL from main thread; main thread replies with tick_url.
      self.postMessage({ type: 'request_url', sessionId: _sessionId })
    }
  }, 1000)
}

function _pause () {
  if (_state !== 'active') return
  _state = 'paused'
  if (_interval) { clearInterval(_interval); _interval = null }
}

function _resume () {
  if (_state !== 'paused') return
  _state = 'active'
  _interval = setInterval(() => {
    if (_state === 'active') {
      self.postMessage({ type: 'request_url', sessionId: _sessionId })
    }
  }, 1000)
}

function _stop () {
  if (_state === 'stopped') return
  _state = 'stopped'
  if (_interval) { clearInterval(_interval); _interval = null }
  if (_stream) {
    for (const t of _stream.getTracks()) t.stop()
    _stream = null
    _track  = null
  }
  _canvas = null
  _ctx2d  = null
  self.postMessage({ type: 'stopped', sessionId: _sessionId })
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', async (ev) => {
  const msg = ev.data || {}
  switch (msg.type) {
    case 'start':
      await _start(msg.config)
      break
    case 'pause':
      _pause()
      break
    case 'resume':
      _resume()
      break
    case 'stop':
      _stop()
      break
    case 'tick_url':
      // Main thread replied to request_url with the current tab URL.
      await _capture(msg.url || '', 'scheduled')
      break
    case 'capture_now':
      // Out-of-band event-sample request (not counted against hourly cap).
      await _capture(msg.url || '', msg.reason || 'event_sample')
      break
    default:
      break
  }
})
