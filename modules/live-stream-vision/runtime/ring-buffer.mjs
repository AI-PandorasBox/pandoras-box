// ring-buffer.mjs — 60s circular frame buffer for live-stream-vision.
// Max 60 slots (1 fps × 60s). FIFO eviction on overflow.
// Each slot: { frame: base64String, timestamp: ISO, url: string, roi: object|null }
// No npm deps. Works in both browser and Node (for testing).

export class RingBuffer {
  constructor (capacity = 60) {
    this._cap  = capacity
    this._buf  = new Array(capacity).fill(null)
    this._head = 0  // next write index
    this._size = 0  // current fill level
  }

  push (entry) {
    if (!entry || typeof entry.frame !== 'string') throw new Error('RingBuffer: entry.frame must be a base64 string')
    this._buf[this._head] = {
      frame:     entry.frame,
      timestamp: entry.timestamp || new Date().toISOString(),
      url:       entry.url       || '',
      roi:       entry.roi       || null,
    }
    this._head = (this._head + 1) % this._cap
    if (this._size < this._cap) this._size++
  }

  // Returns latest entry, or null if empty.
  latest () {
    if (this._size === 0) return null
    const idx = (this._head - 1 + this._cap) % this._cap
    return this._buf[idx]
  }

  // Returns all entries oldest-first, up to this._size items.
  all () {
    if (this._size === 0) return []
    const out = []
    const oldest = this._size < this._cap
      ? 0
      : this._head  // head points to oldest slot when full
    for (let i = 0; i < this._size; i++) {
      out.push(this._buf[(oldest + i) % this._cap])
    }
    return out
  }

  // How old is the latest frame in seconds? Returns Infinity if empty.
  ageSeconds () {
    const l = this.latest()
    if (!l) return Infinity
    return (Date.now() - new Date(l.timestamp).getTime()) / 1000
  }

  clear () {
    this._buf  = new Array(this._cap).fill(null)
    this._head = 0
    this._size = 0
  }

  get size () { return this._size }
  get capacity () { return this._cap }
}
