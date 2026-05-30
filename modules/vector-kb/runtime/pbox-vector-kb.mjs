#!/usr/bin/env node
// pbox-vector-kb.mjs -- local semantic memory (vector store) for Pandora's Box.
// Embeds text with a LOCAL model via Ollama, stores vectors in SQLite, and
// answers nearest-neighbour search. Localhost-only. No external network, no API
// cost. This is the "vector" layer of the memory system.  _VECTOR_KB_V1
//
//   POST /ingest   {text, source?, tags?}  or  {items:[{text,source?,tags?}, ...]}
//   GET  /search?q=...&k=5
//   DELETE /item?id=N        (used by pbox-import --undo)
//   GET  /healthz
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = parseInt(process.env.VECTOR_KB_PORT || '8486', 10)
const BIND = process.env.VECTOR_KB_BIND || '127.0.0.1'
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const EMBED_MODEL = process.env.VECTOR_KB_MODEL || 'nomic-embed-text'
const STORE_DIR = process.env.VECTOR_KB_STORE || path.join(process.env.INSTALL_PATH || '/opt/pandoras-box', 'vector-kb', 'store')
const DB_PATH = process.env.VECTOR_KB_DB || path.join(STORE_DIR, 'vectors.db')
const MAX_TEXT = 8000

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.prepare('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, source TEXT, tags TEXT, created_at INTEGER, dim INTEGER, embedding TEXT)').run()
const insItem = db.prepare('INSERT INTO items (text, source, tags, created_at, dim, embedding) VALUES (?, ?, ?, ?, ?, ?)')
const delItem = db.prepare('DELETE FROM items WHERE id = ?')
const allItems = db.prepare('SELECT id, text, source, tags, embedding FROM items')

// Embed via local Ollama. Test-only deterministic fallback when
// PBOX_VECTOR_FAKE_EMBED=1 (no Ollama needed) -- never used in production.
async function embed(text) {
  if (process.env.PBOX_VECTOR_FAKE_EMBED === '1') {
    const v = new Array(64).fill(0)
    for (const tok of String(text).toLowerCase().split(/\W+/)) {
      if (!tok) continue
      let h = 0; for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0
      v[h % 64] += 1
    }
    return v
  }
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: String(text).slice(0, MAX_TEXT) }),
  })
  if (!r.ok) throw new Error(`ollama embeddings ${r.status} (is the ollama module installed + model "${EMBED_MODEL}" pulled?)`)
  const j = await r.json()
  if (!Array.isArray(j.embedding)) throw new Error('ollama returned no embedding')
  return j.embedding
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; let n = 0
    req.on('data', c => { n += c.length; if (n > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy() } d += c })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

const server = http.createServer(async (req, res) => {
  let url
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`) } catch { return json(res, 400, { error: 'bad url' }) }
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      const count = db.prepare('SELECT COUNT(*) c FROM items').get().c
      let ollama = false
      try { ollama = (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })).ok } catch {}
      return json(res, 200, { ok: true, items: count, model: EMBED_MODEL, ollama })
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(`<!doctype html><title>Vector KB</title><body style="font-family:system-ui;background:#0a0a14;color:#f0f0ff;padding:40px"><h1>Vector KB</h1><p>Semantic memory. POST /ingest, GET /search?q=, GET /healthz.</p></body>`)
    }
    if (req.method === 'POST' && url.pathname === '/ingest') {
      const body = JSON.parse(await readBody(req) || '{}')
      const items = Array.isArray(body.items) ? body.items : [body]
      const ids = []
      for (const it of items) {
        const text = String(it.text || '').trim().slice(0, MAX_TEXT)
        if (!text) continue
        const e = await embed(text)
        const r = insItem.run(text, it.source || null, it.tags ? JSON.stringify(it.tags) : null, Date.now(), e.length, JSON.stringify(e))
        ids.push(Number(r.lastInsertRowid))
      }
      return json(res, 200, { ingested: ids.length, ids })
    }
    if (req.method === 'GET' && url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim()
      const k = Math.min(50, Math.max(1, parseInt(url.searchParams.get('k') || '5', 10)))
      if (!q) return json(res, 400, { error: 'missing q' })
      const qe = await embed(q)
      const scored = []
      for (const row of allItems.all()) {
        let emb; try { emb = JSON.parse(row.embedding) } catch { continue }
        scored.push({ id: row.id, text: row.text, source: row.source, score: cosine(qe, emb) })
      }
      scored.sort((a, b) => b.score - a.score)
      return json(res, 200, { query: q, results: scored.slice(0, k) })
    }
    if (req.method === 'DELETE' && url.pathname === '/item') {
      const id = parseInt(url.searchParams.get('id') || '', 10)
      if (!Number.isInteger(id)) return json(res, 400, { error: 'missing id' })
      delItem.run(id)
      return json(res, 200, { deleted: id })
    }
    json(res, 404, { error: 'not found' })
  } catch (e) { json(res, 500, { error: String(e.message || e) }) }
})

server.listen(PORT, BIND, () => {
  console.log(`[vector-kb] listening on http://${BIND}:${PORT}`)
  console.log(`[vector-kb] db ${DB_PATH} | embeddings via ${OLLAMA_URL} (${EMBED_MODEL})`)
})
