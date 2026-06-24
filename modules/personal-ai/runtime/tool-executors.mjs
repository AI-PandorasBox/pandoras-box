// tool-executors.mjs -- FROZEN, self-contained executors for the BOX-SAFE public tool subset.
// _PUBLIC_EXECUTORS_V1
//
// PURPOSE
//   The public personal-ai assistant ships a 65-tool catalogue (tool-catalogue.json).
//   This module supplies WORKING executors for the BOX-SAFE subset only:
//   personal-data + local-content + search. Each executor runs against THIS box's own
//   local SQLite (memory.db) and a sandboxed filesystem under the module store. There
//   is NO coupling to any external/master DB, no shared schema, no secrets, no
//   multi-tenant access, no network-write, no shell-out to operator strings.
//
//   Tool CONTRACTS (names, inputs, return shapes) mirror the live master so packaged
//   skills written against the master keep working. The IMPLEMENTATIONS are independent
//   and frozen here.
//
// SAFETY BOUNDARY (what this module deliberately does NOT do)
//   - No ms365_* / gmail (multi-tenant -- a public user wires their own single account).
//   - No web_action_* / drive-mode / run_script / ftp / network-write.
//   - No admin / orchestration / internal-agent / business-system tools.
//   - Search tools (brave/grounded/deep_research/stock) ONLY make outbound READ calls and
//     ONLY when the user has configured the relevant API key; with no key they return a
//     clear "configure key" error -- never a fabricated result.
//   - File tools are confined to a per-box sandbox (drops dir). Path traversal is blocked.
//
// USAGE
//   import { createExecutors } from './tool-executors.mjs'
//   const ex = createExecutors({ db, storeDir, env })
//   ex.has('save_memory')            -> true
//   await ex.run('save_memory', { content: '...' })
//   ex.names()                       -> [ ...executor tool names... ]

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ── small helpers ───────────────────────────────────────────────────────────
const FILENAME_RE = /^[a-zA-Z0-9_\-. ]+$/
function esc (s) { return String(s == null ? '' : s) }
function nowIso () { return new Date().toISOString() }

// PDF: minimal, dependency-free, single-page-per-chunk text PDF writer. Produces a
// genuinely valid PDF (openable in any reader). Not a layout engine -- it ships the
// content as monospaced text, which is the honest local-only capability.
function buildTextPdf (title, body) {
  const lines = []
  if (title) { lines.push(title); lines.push('') }
  for (const raw of String(body || '').split('\n')) {
    // wrap at ~95 chars
    let s = raw
    while (s.length > 95) { lines.push(s.slice(0, 95)); s = s.slice(95) }
    lines.push(s)
  }
  const pdfEsc = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  let stream = 'BT /F1 11 Tf 50 770 Td 14 TL\n'
  for (const ln of lines.slice(0, 3000)) stream += `(${pdfEsc(ln)}) Tj T*\n`
  stream += 'ET'
  const objs = []
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>')
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')
  objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefPos = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

// DOCX: minimal valid OOXML wrapper, dependency-free (a .docx is a ZIP). We build the
// ZIP by hand (stored, no compression) so there is no dependency.
function buildDocx (paragraphs) {
  const xmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join('')
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: 'word/document.xml', data: Buffer.from(docXml) },
  ])
}

// XLSX: minimal valid OOXML spreadsheet, dependency-free ZIP. sheets = [{name, rows:[[..]]}]
function buildXlsx (sheets) {
  const xmlEsc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const colRef = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
  const sheetXml = (rows) => {
    const rowXml = rows.map((row, ri) => {
      const cells = row.map((val, ci) => {
        const ref = colRef(ci) + (ri + 1)
        if (typeof val === 'number' && Number.isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`
      }).join('')
      return `<row r="${ri + 1}">${cells}</row>`
    }).join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`
  }
  const sList = sheets.length ? sheets : [{ name: 'Sheet1', rows: [[]] }]
  const sheetsMeta = sList.map((s, i) => ({ name: (s.name || `Sheet${i + 1}`).slice(0, 31), rows: Array.isArray(s.rows) ? s.rows : [] }))
  const wbSheets = sheetsMeta.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets}</sheets></workbook>`
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetsMeta.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetsMeta.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels) },
  ]
  sheetsMeta.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s.rows)) }))
  return zipStore(files)
}

// Minimal ZIP writer (STORE method, no compression) -- enough for OOXML containers.
// Dependency-free; CRC32 computed inline.
function crc32 (buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & (-(c & 1)))
  }
  return (~c) >>> 0
}
function zipStore (files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name)
    const crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, f.data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(f.data.length, 20); cd.writeUInt32LE(f.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += local.length + nameBuf.length + f.data.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuf, end])
}

// ── factory ─────────────────────────────────────────────────────────────────
export function createExecutors ({ db, storeDir, env = {}, model = null }) {
  // Optional model helper (injected by the runtime). Lets vision + book tools
  // generate content with the user's OWN connected model. When absent or no key
  // is connected, those tools return a friendly "connect your model key" message
  // (never a crash, never a fabricated result). _PUBLIC_MODEL_TOOLS_V1
  const MODEL_NOT_CONNECTED =
    (model && model.notConnectedMessage) ||
    'No model is connected. Add your Anthropic API key in the installer (the API-key ' +
    'step) or sign in with your subscription, then retry. This tool uses your connected ' +
    'model and may incur API cost.'
  // Text generation works via a direct API key OR the subscription CLI bridge, so
  // book tools only need the helper to be wired. Vision needs a direct key (the
  // multimodal path), which the vision helper itself enforces.
  function modelReady () { return !!(model && typeof model.complete === 'function') }
  // Image generation readiness: the helper must expose image() AND an image key must be
  // present (the user's GEMINI_API_KEY / IMAGE_API_KEY). When not ready the image tools
  // return a friendly "set GEMINI_API_KEY" message rather than crashing or fabricating an
  // image. _PUBLIC_IMAGE_TOOLS_V1
  const IMAGE_NOT_CONNECTED =
    (model && model.imageNotConnectedMessage) ||
    'Image generation needs an image model -- set GEMINI_API_KEY (or IMAGE_API_KEY) in ' +
    'the installer/config to enable this. This tool uses your connected image model and ' +
    'may incur API cost.'
  function imageReady () {
    return !!(model && typeof model.image === 'function' &&
      (typeof model.hasImageKey !== 'function' || model.hasImageKey()))
  }
  // Generate one image and save the bytes into the sandbox (default store/generated, or a
  // caller-supplied subdir under the sandbox). Returns { filename, path, media_type } on
  // success, or { __image_error } when no image model is connected / the call fails.
  const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }
  async function modelImageToFile (prompt, opts = {}) {
    if (!imageReady()) return { __image_error: IMAGE_NOT_CONNECTED }
    const p = String(prompt || '').trim()
    if (!p) return { error: 'prompt required' }
    let outDir = GEN_ROOT
    if (opts.subdir) {
      const safe = safeJoin(GEN_ROOT, String(opts.subdir))
      if (!safe) return { error: 'invalid subdir' }
      outDir = safe
      fs.mkdirSync(outDir, { recursive: true })
    }
    try {
      const img = await model.image({ prompt: p, opts: opts.modelOpts || {} })
      if (!img || !img.data) return { __image_error: IMAGE_NOT_CONNECTED }
      const ext = IMAGE_EXT[img.media_type] || '.png'
      const base = String(opts.basename || 'image').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'image'
      const filename = base + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext
      const full = path.join(outDir, filename)
      fs.writeFileSync(full, Buffer.from(img.data, 'base64'))
      const rel = path.relative(GEN_ROOT, full)
      return { filename, rel, path: full, media_type: img.media_type }
    } catch (e) {
      if (e && (e.code === 'NO_IMAGE_KEY')) return { __image_error: e.message || IMAGE_NOT_CONNECTED }
      // Auth / network / quota failures surface as the friendly connect-your-key note
      // (with a short cause) so the assistant never crashes or pretends an image exists.
      return { __image_error: IMAGE_NOT_CONNECTED + ' (' + String(e && e.message || e).slice(0, 160) + ')' }
    }
  }
  async function modelText (system, user, max_tokens) {
    if (!modelReady()) return { __model_error: MODEL_NOT_CONNECTED }
    try {
      const text = await model.complete({ system, user, max_tokens })
      if (!text || !String(text).trim()) return { __model_error: MODEL_NOT_CONNECTED }
      return { text: String(text) }
    } catch (e) {
      // A connection / auth failure surfaces as the friendly connect-your-key note.
      return { __model_error: MODEL_NOT_CONNECTED + ' (' + String(e && e.message || e).slice(0, 160) + ')' }
    }
  }
  // Local sandboxes (created lazily, never escape storeDir).
  const VAULT_ROOT = path.join(storeDir, 'vault')
  const DROPS_ROOT = path.join(storeDir, 'drops')
  const GEN_ROOT = path.join(storeDir, 'generated')
  const STATE_DIR = path.join(storeDir, 'state')
  for (const d of [VAULT_ROOT, DROPS_ROOT, GEN_ROOT, STATE_DIR]) fs.mkdirSync(d, { recursive: true })
  const IMPORTANT_LIST_PATH = path.join(STATE_DIR, 'important-list.json')

  // ── schema (frozen, independent of master) ──────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS pai_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT,
      due_date TEXT, priority TEXT DEFAULT 'medium', company TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS pai_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT, email TEXT,
      phone TEXT, notes TEXT, job_title TEXT, role TEXT, org_type TEXT, industry TEXT,
      created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS pai_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL,
      category TEXT DEFAULT 'general', importance_tier INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()), invalid_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS pai_commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, due_date TEXT,
      party TEXT, direction TEXT DEFAULT 'self_to_other', status TEXT DEFAULT 'open',
      notes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pai_graph_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, name TEXT NOT NULL,
      canonical TEXT NOT NULL, metadata TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pai_graph_rels (
      id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
      rel_type TEXT NOT NULL, strength REAL DEFAULT 1.0, last_seen TEXT,
      interaction_count INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pai_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, canonical TEXT NOT NULL,
      lat REAL, lng REAL, radius_m INTEGER DEFAULT 150, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pai_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT NOT NULL, scheduled_for INTEGER NOT NULL,
      status TEXT DEFAULT 'pending', label TEXT, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS pai_ical_sources (
      alias TEXT PRIMARY KEY, name TEXT, url TEXT NOT NULL, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS pai_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, title TEXT, subtitle TEXT,
      status TEXT DEFAULT 'drafting', research TEXT, outline TEXT, listing TEXT,
      created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS pai_book_chapters (
      book_id INTEGER NOT NULL, chapter_n INTEGER NOT NULL, title TEXT, content TEXT,
      word_count INTEGER DEFAULT 0, updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (book_id, chapter_n)
    );
  `)
  // FTS index for memory recall (graceful if unavailable).
  let ftsOk = true
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS pai_memories_fts USING fts5(content, content='pai_memories', content_rowid='id')`)
  } catch { ftsOk = false }

  // ── path safety ──
  function safeJoin (root, rel) {
    const cleaned = String(rel || '').replace(/\\/g, '/').replace(/\.\.(\/|$)/g, '')
    const full = path.resolve(root, cleaned)
    if (full !== root && !full.startsWith(root + path.sep)) return null
    return full
  }

  // ── MEMORY ──
  function saveMemory (content, category, opts = {}) {
    const c = String(content || '').trim()
    if (!c) return { error: 'content required' }
    const tier = opts.importance_tier != null ? Number(opts.importance_tier) : 1
    if (opts.supersedes_id) { try { db.prepare('UPDATE pai_memories SET invalid_at = unixepoch() WHERE id = ? AND invalid_at IS NULL').run(Number(opts.supersedes_id)) } catch {} }
    const r = db.prepare('INSERT INTO pai_memories (content, category, importance_tier) VALUES (?,?,?)').run(c, category || 'general', tier)
    if (ftsOk) { try { db.prepare('INSERT INTO pai_memories_fts(rowid, content) VALUES (?, ?)').run(Number(r.lastInsertRowid), c) } catch {} }
    return { saved: true, id: Number(r.lastInsertRowid), content: c }
  }
  function recallMemory (query) {
    const q = String(query || '').trim()
    if (!q) return { memories: [], source: 'empty' }
    if (ftsOk) {
      try {
        const safe = q.split(/\s+/).filter(Boolean).map(t => '"' + t.replace(/"/g, '""') + '*"').join(' ')
        const rows = db.prepare(`SELECT m.id, m.content, m.category, m.created_at FROM pai_memories m JOIN pai_memories_fts f ON f.rowid = m.id WHERE pai_memories_fts MATCH ? AND (m.invalid_at IS NULL OR m.invalid_at > unixepoch()) ORDER BY rank LIMIT 10`).all(safe)
        if (rows.length) return { memories: rows, source: 'fts' }
      } catch {}
    }
    const rows = db.prepare("SELECT id, content, category, created_at FROM pai_memories WHERE content LIKE ? AND (invalid_at IS NULL OR invalid_at > unixepoch()) ORDER BY created_at DESC LIMIT 10").all(`%${q}%`)
    return { memories: rows, source: 'like' }
  }
  function updateMemory (id, content, category) {
    const sets = [], vals = []
    if (content !== undefined) { sets.push('content = ?'); vals.push(content) }
    if (category !== undefined) { sets.push('category = ?'); vals.push(category) }
    if (!sets.length) return { error: 'No fields to update' }
    vals.push(id)
    db.prepare(`UPDATE pai_memories SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    if (content !== undefined && ftsOk) { try { db.prepare('DELETE FROM pai_memories_fts WHERE rowid = ?').run(id); db.prepare('INSERT INTO pai_memories_fts(rowid, content) VALUES (?, ?)').run(id, content) } catch {} }
    return { ok: true, id }
  }
  function deleteMemory (id) {
    db.prepare('DELETE FROM pai_memories WHERE id = ?').run(id)
    if (ftsOk) { try { db.prepare('DELETE FROM pai_memories_fts WHERE rowid = ?').run(id) } catch {} }
    return { ok: true, id }
  }

  // ── TASKS ──
  function getTasks (status) {
    if (status) return { tasks: db.prepare('SELECT * FROM pai_tasks WHERE status = ? ORDER BY due_date IS NULL, due_date ASC, id ASC').all(status) }
    return { tasks: db.prepare("SELECT * FROM pai_tasks WHERE status != 'done' ORDER BY due_date IS NULL, due_date ASC, id ASC").all() }
  }
  function addTask (title, notes, due_date, priority, company) {
    const t = String(title || '').trim()
    if (!t) return { error: 'title required' }
    const r = db.prepare('INSERT INTO pai_tasks (title, notes, due_date, priority, company) VALUES (?,?,?,?,?)').run(t.slice(0, 200), notes || null, due_date || null, priority || 'medium', company || null)
    return { id: Number(r.lastInsertRowid), title: t, status: 'pending' }
  }
  function updateTask (id, fields) {
    const allowed = ['title', 'notes', 'due_date', 'priority', 'status', 'company']
    const sets = [], vals = []
    for (const [k, v] of Object.entries(fields || {})) if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v) }
    if (!sets.length) return { error: 'No valid fields to update' }
    sets.push('updated_at = unixepoch()'); vals.push(id)
    db.prepare(`UPDATE pai_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return db.prepare('SELECT * FROM pai_tasks WHERE id = ?').get(id) || { error: 'not found', id }
  }

  // ── CONTACTS ──
  function searchContacts (search) {
    if (search) {
      const like = `%${search}%`
      return { contacts: db.prepare('SELECT * FROM pai_contacts WHERE name LIKE ? OR company LIKE ? OR email LIKE ? OR job_title LIKE ? OR role LIKE ? ORDER BY name LIMIT 10').all(like, like, like, like, like) }
    }
    return { contacts: db.prepare('SELECT * FROM pai_contacts ORDER BY name LIMIT 50').all() }
  }
  function addContact (i) {
    const name = String(i.name || '').trim()
    if (!name) return { error: 'name required' }
    if (i.email) {
      const existing = db.prepare('SELECT id, name FROM pai_contacts WHERE LOWER(email) = ?').get(String(i.email).toLowerCase())
      if (existing) return { id: existing.id, created: false, reason: 'duplicate email' }
    }
    const notes = [i.industry ? `Industry: ${i.industry}` : null, i.notes].filter(Boolean).join('. ') || null
    const r = db.prepare('INSERT INTO pai_contacts (name, company, email, phone, notes, job_title, role, org_type, industry) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(name, i.company || null, i.email || null, i.phone || null, notes, i.job_title || null, i.role || null, i.org_type || null, i.industry || null)
    return { id: Number(r.lastInsertRowid), created: true, name }
  }
  function updateContact (id, fields) {
    const allowed = ['name', 'company', 'email', 'phone', 'notes', 'job_title', 'role', 'org_type', 'industry']
    const sets = [], vals = []
    for (const k of allowed) if (fields[k] !== undefined) { sets.push(`${k} = ?`); vals.push(fields[k]) }
    if (!sets.length) return { error: 'No fields to update' }
    sets.push('updated_at = unixepoch()'); vals.push(id)
    db.prepare(`UPDATE pai_contacts SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return { ok: true, id }
  }
  function deleteContact (id) { db.prepare('DELETE FROM pai_contacts WHERE id = ?').run(id); return { ok: true, id } }

  // ── IMPORTANT LIST ──
  function importantListRead () {
    try { if (!fs.existsSync(IMPORTANT_LIST_PATH)) return { items: [], count: 0 }; const l = JSON.parse(fs.readFileSync(IMPORTANT_LIST_PATH, 'utf8')); return { items: l.items || [], count: (l.items || []).length } } catch (e) { return { error: e.message } }
  }
  function importantListAdd (item, source) {
    if (!item) return { error: 'item required' }
    let l = { items: [] }
    try { if (fs.existsSync(IMPORTANT_LIST_PATH)) l = JSON.parse(fs.readFileSync(IMPORTANT_LIST_PATH, 'utf8')) } catch {}
    if (!l.items) l.items = []
    l.items.push({ item, source: source || 'session', added: nowIso() })
    fs.writeFileSync(IMPORTANT_LIST_PATH, JSON.stringify(l, null, 2))
    return { ok: true, count: l.items.length }
  }
  function importantListRemove (index) {
    try {
      if (!fs.existsSync(IMPORTANT_LIST_PATH)) return { error: 'List not found' }
      const l = JSON.parse(fs.readFileSync(IMPORTANT_LIST_PATH, 'utf8'))
      if (!l.items || index < 0 || index >= l.items.length) return { error: 'Index out of range' }
      const removed = l.items.splice(index, 1)[0]
      fs.writeFileSync(IMPORTANT_LIST_PATH, JSON.stringify(l, null, 2))
      return { ok: true, removed, remaining: l.items.length }
    } catch (e) { return { error: e.message } }
  }

  // ── COMMITMENTS ──
  function commitmentAdd (description, due_date, party, direction, notes) {
    if (!description) return { error: 'description required' }
    const r = db.prepare('INSERT INTO pai_commitments (description, due_date, party, direction, notes) VALUES (?,?,?,?,?)').run(description, due_date || null, party || null, direction || 'self_to_other', notes || null)
    return { ok: true, id: Number(r.lastInsertRowid), description }
  }
  function commitmentList (status) {
    const filter = status || 'open'
    const today = nowIso().slice(0, 10)
    db.prepare("UPDATE pai_commitments SET status='overdue', updated_at=datetime('now') WHERE status='open' AND due_date IS NOT NULL AND due_date < ?").run(today)
    const rows = filter === 'all' ? db.prepare('SELECT * FROM pai_commitments ORDER BY due_date ASC, created_at ASC').all() : db.prepare('SELECT * FROM pai_commitments WHERE status=? ORDER BY due_date ASC, created_at ASC').all(filter)
    return { commitments: rows, count: rows.length, filter }
  }
  function commitmentDone (id, notes) {
    if (!id) return { error: 'id required' }
    const ex = db.prepare('SELECT * FROM pai_commitments WHERE id=?').get(id)
    if (!ex) return { error: 'not found', id }
    db.prepare("UPDATE pai_commitments SET status='done', notes=?, updated_at=datetime('now') WHERE id=?").run(notes ? (ex.notes ? ex.notes + ' | ' + notes : notes) : ex.notes, id)
    return { ok: true, id, description: ex.description }
  }

  // ── GRAPH ──
  function graphUpsertEntity (entity_type, name, canonical, metadata) {
    if (!entity_type || !name) return { error: 'entity_type and name required' }
    const canon = (canonical || name).toLowerCase().trim()
    const meta = metadata ? JSON.stringify(metadata) : null
    const now = nowIso()
    const ex = db.prepare('SELECT id FROM pai_graph_entities WHERE entity_type=? AND canonical=?').get(entity_type, canon)
    let id
    if (ex) { db.prepare('UPDATE pai_graph_entities SET name=?, metadata=?, updated_at=? WHERE id=?').run(name, meta, now, ex.id); id = ex.id }
    else { const r = db.prepare('INSERT INTO pai_graph_entities (entity_type, name, canonical, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(entity_type, name, canon, meta, now, now); id = Number(r.lastInsertRowid) }
    return { ok: true, id, entity_type, name, canonical: canon, action: ex ? 'updated' : 'created' }
  }
  function graphUpsertRelationship (from_id, to_id, rel_type, strength) {
    if (!from_id || !to_id || !rel_type) return { error: 'from_id, to_id, rel_type required' }
    const now = nowIso()
    const ex = db.prepare('SELECT id, interaction_count FROM pai_graph_rels WHERE from_id=? AND to_id=? AND rel_type=?').get(from_id, to_id, rel_type)
    if (ex) { const ic = (ex.interaction_count || 1) + 1; db.prepare('UPDATE pai_graph_rels SET strength=?, last_seen=?, interaction_count=?, updated_at=? WHERE id=?').run(strength ?? 1.0, now, ic, now, ex.id); return { ok: true, id: ex.id, action: 'strengthened', interaction_count: ic } }
    const r = db.prepare('INSERT INTO pai_graph_rels (from_id, to_id, rel_type, strength, last_seen, interaction_count, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)').run(from_id, to_id, rel_type, strength ?? 1.0, now, now, now)
    return { ok: true, id: Number(r.lastInsertRowid), action: 'created' }
  }
  function graphFindEntity (name, type) {
    if (!name) return { error: 'name required' }
    const canon = name.toLowerCase().trim()
    const row = type
      ? db.prepare('SELECT * FROM pai_graph_entities WHERE entity_type=? AND (canonical=? OR name LIKE ?)').get(type, canon, '%' + name + '%')
      : db.prepare('SELECT * FROM pai_graph_entities WHERE canonical=? OR name LIKE ? ORDER BY updated_at DESC LIMIT 1').get(canon, '%' + name + '%')
    return row ? { found: true, entity: row } : { found: false, name }
  }
  function graphFindPerson (name) {
    if (!name) return { error: 'name required' }
    const canon = name.toLowerCase().trim()
    const e = db.prepare("SELECT * FROM pai_graph_entities WHERE entity_type='person' AND (canonical=? OR name LIKE ?) ORDER BY updated_at DESC LIMIT 1").get(canon, '%' + name + '%')
    if (!e) return { found: false, name }
    const out = db.prepare('SELECT r.*, e.name AS to_name, e.entity_type AS to_type FROM pai_graph_rels r JOIN pai_graph_entities e ON e.id=r.to_id WHERE r.from_id=? ORDER BY r.last_seen DESC').all(e.id)
    const inn = db.prepare('SELECT r.*, e.name AS from_name, e.entity_type AS from_type FROM pai_graph_rels r JOIN pai_graph_entities e ON e.id=r.from_id WHERE r.to_id=? ORDER BY r.last_seen DESC').all(e.id)
    return { found: true, entity: e, connections: { outgoing: out, incoming: inn } }
  }

  // ── PLACES ──
  function placeUpsert (name, lat, lng, radius_m, canonical) {
    if (!name || lat == null || lng == null) return { error: 'name, lat, lng required' }
    const canon = (canonical || name).toLowerCase().trim()
    const now = nowIso()
    const ex = db.prepare('SELECT id FROM pai_places WHERE canonical=?').get(canon)
    if (ex) { db.prepare('UPDATE pai_places SET name=?, lat=?, lng=?, radius_m=?, updated_at=? WHERE id=?').run(name, lat, lng, radius_m || 150, now, ex.id); return { ok: true, id: ex.id, action: 'updated', name, canonical: canon } }
    const r = db.prepare('INSERT INTO pai_places (name, canonical, lat, lng, radius_m, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(name, canon, lat, lng, radius_m || 150, now, now)
    return { ok: true, id: Number(r.lastInsertRowid), action: 'created', name, canonical: canon }
  }
  function placeList () { return { places: db.prepare('SELECT * FROM pai_places ORDER BY name ASC').all() } }
  function placeDelete (id) {
    if (!id) return { error: 'id required' }
    const ex = db.prepare('SELECT * FROM pai_places WHERE id=?').get(id)
    if (!ex) return { error: 'not found', id }
    db.prepare('DELETE FROM pai_places WHERE id=?').run(id)
    return { ok: true, id, name: ex.name }
  }

  // ── SCHEDULE (records the schedule; firing is the assistant runtime's job) ──
  function scheduleTask (prompt, scheduledForStr, label) {
    if (!prompt || !scheduledForStr) return { error: 'prompt and scheduled_for are required' }
    const ts = new Date(scheduledForStr).getTime()
    if (isNaN(ts)) return { error: 'Invalid scheduled_for -- use ISO 8601 datetime' }
    if (ts < Date.now()) return { error: 'scheduled_for is in the past' }
    const r = db.prepare('INSERT INTO pai_schedule (prompt, scheduled_for, label) VALUES (?,?,?)').run(prompt, ts, label || null)
    return { scheduled: true, id: Number(r.lastInsertRowid), fires_at: new Date(ts).toISOString(), prompt: prompt.slice(0, 80) }
  }
  function scheduleList () {
    const rows = db.prepare("SELECT id, prompt, scheduled_for, status, label FROM pai_schedule WHERE status IN ('pending','running') ORDER BY scheduled_for ASC LIMIT 20").all()
    return { scheduled: rows.map(r => ({ id: r.id, label: r.label || r.prompt.slice(0, 60), fires_at: new Date(r.scheduled_for).toISOString(), status: r.status })), count: rows.length }
  }

  // ── VAULT (sandboxed under store/vault) ──
  function vaultRead (relPath) {
    const fp = safeJoin(VAULT_ROOT, relPath); if (!fp) return { error: 'invalid path' }
    if (!fs.existsSync(fp)) return { found: false, path: relPath }
    const content = fs.readFileSync(fp, 'utf8')
    return { found: true, path: relPath, content, length: content.length }
  }
  function vaultWrite (relPath, content) {
    const fp = safeJoin(VAULT_ROOT, relPath); if (!fp) return { error: 'invalid path' }
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, String(content ?? ''), 'utf8')
    return { ok: true, path: relPath, bytes: Buffer.byteLength(String(content ?? '')) }
  }
  function vaultSearch (query, maxResults) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return { results: [], total: 0 }
    const results = []
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir)) {
        const fp = path.join(dir, entry); const st = fs.statSync(fp)
        if (st.isDirectory()) { walk(fp); continue }
        if (!entry.endsWith('.md')) continue
        const raw = fs.readFileSync(fp, 'utf8'); const lower = raw.toLowerCase()
        const hits = terms.filter(t => lower.includes(t)).length
        if (hits > 0) results.push({ path: fp.replace(VAULT_ROOT + path.sep, ''), hits, excerpt: raw.slice(0, 300) })
      }
    }
    walk(VAULT_ROOT)
    results.sort((a, b) => b.hits - a.hits)
    return { results: results.slice(0, maxResults || 5), total: results.length }
  }
  function vaultList (dir) {
    const fp = safeJoin(VAULT_ROOT, dir || ''); if (!fp) return { error: 'invalid path' }
    if (!fs.existsSync(fp)) return { entries: [], note: 'Directory does not exist yet' }
    const entries = fs.readdirSync(fp).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
    return { dir: dir || '', entries, count: entries.length }
  }

  // ── DROPS / FILES (sandboxed under store/drops) ──
  function saveDropFile (i) {
    const filename = String(i.filename || ('note-' + Date.now() + '.txt'))
    if (!FILENAME_RE.test(filename)) return { error: 'invalid filename' }
    const sub = (i.company || 'personal').replace(/[^a-zA-Z0-9_-]/g, '_')
    const cat = (i.category || 'files').replace(/[^a-zA-Z0-9_-]/g, '_')
    const dir = path.join(DROPS_ROOT, sub, cat)
    fs.mkdirSync(dir, { recursive: true })
    const data = i.encoding === 'base64' ? Buffer.from(String(i.content || ''), 'base64') : String(i.content ?? '')
    fs.writeFileSync(path.join(dir, filename), data)
    return { ok: true, filename, company: sub, category: cat }
  }
  function listDrops (query) {
    const q = String(query || '').toLowerCase().trim()
    const files = []
    const walk = (dir, co, cat) => {
      if (!fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const fp = path.join(dir, e.name)
        if (e.isDirectory()) { walk(fp, co || e.name, co ? e.name : cat); continue }
        if (q && !e.name.toLowerCase().includes(q)) continue
        const st = fs.statSync(fp)
        files.push({ company: co, category: cat, filename: e.name, size: st.size, modified: new Date(st.mtimeMs).toISOString().slice(0, 10) })
      }
    }
    walk(DROPS_ROOT, null, null)
    files.sort((a, b) => b.modified.localeCompare(a.modified))
    return { files, count: files.length, query: q || null }
  }
  function findDrop (filename) {
    if (!filename || !FILENAME_RE.test(filename)) return null
    let found = null
    const walk = (dir) => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const fp = path.join(dir, e.name); if (e.isDirectory()) walk(fp); else if (e.name === filename && !found) found = fp } }
    walk(DROPS_ROOT)
    return found
  }
  function readDropFile (filename) {
    const fp = findDrop(filename); if (!fp) return { error: 'File not found in drops: ' + filename }
    const ext = path.extname(fp).toLowerCase()
    if (['.txt', '.md', '.csv', '.json'].includes(ext)) { return { filename, content: fs.readFileSync(fp, 'utf8').slice(0, 100000) } }
    return { filename, note: 'binary file; content not inlined', size: fs.statSync(fp).size }
  }
  function deleteDropFile (filename) {
    const fp = findDrop(filename); if (!fp) return { error: 'File not found in drops: ' + filename }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')
    fs.unlinkSync(fp)
    return { ok: true, filename, sha256: sha }
  }
  function deleteDropsBatch (filenames) {
    if (!Array.isArray(filenames)) return { error: 'filenames array required' }
    return { results: filenames.map(f => { const r = deleteDropFile(f); return { filename: f, status: r.ok ? 'deleted' : 'error', error: r.error } }) }
  }
  function renameDropFile (oldName, newName) {
    if (!FILENAME_RE.test(oldName || '') || !FILENAME_RE.test(newName || '')) return { error: 'invalid filename' }
    const fp = findDrop(oldName); if (!fp) return { error: 'File not found: ' + oldName }
    const target = path.join(path.dirname(fp), newName)
    fs.renameSync(fp, target)
    return { ok: true, old_filename: oldName, new_filename: newName }
  }

  // ── GENERATE (local, dependency-free) ──
  function recordGen (kind, title, filename) { return { ok: true, kind, title, filename, path: path.join(GEN_ROOT, filename) } }
  function generatePdf (i) {
    const filename = (String(i.filename || 'document').replace(/[^a-zA-Z0-9_-]/g, '_') || 'document') + '.pdf'
    const title = i.title || i.template || 'Document'
    const bodyText = i.html ? String(i.html).replace(/<[^>]+>/g, '') : (i.data ? (typeof i.data === 'string' ? i.data : JSON.stringify(i.data, null, 2)) : '')
    fs.writeFileSync(path.join(GEN_ROOT, filename), buildTextPdf(title, bodyText))
    return recordGen('pdf', title, filename)
  }
  function generateDocx (i) {
    const filename = (String(i.filename || 'document').replace(/[^a-zA-Z0-9_-]/g, '_') || 'document') + '.docx'
    const content = typeof i.content === 'string' ? i.content : JSON.stringify(i.content || '', null, 2)
    const paras = content.split('\n')
    fs.writeFileSync(path.join(GEN_ROOT, filename), buildDocx(paras.length ? paras : ['']))
    return recordGen('docx', i.filename || 'document', filename)
  }
  function generateXlsx (i) {
    const filename = (String(i.filename || 'workbook').replace(/[^a-zA-Z0-9_-]/g, '_') || 'workbook') + '.xlsx'
    let sheets = i.sheets
    if (!Array.isArray(sheets)) sheets = [{ name: 'Sheet1', rows: [] }]
    sheets = sheets.map(s => ({ name: s.name, rows: Array.isArray(s.rows) ? s.rows : (Array.isArray(s.data) ? s.data : []) }))
    fs.writeFileSync(path.join(GEN_ROOT, filename), buildXlsx(sheets))
    return recordGen('xlsx', i.filename || 'workbook', filename)
  }

  // ── iCAL (local registry + outbound READ fetch) ──
  function icalListSources () { return { sources: db.prepare('SELECT alias, name, url, notes FROM pai_ical_sources ORDER BY alias').all() } }
  function icalRegisterSource (i) {
    if (!i.alias || !i.url) return { error: 'alias and url required' }
    if (!/^https:\/\//i.test(i.url)) return { error: 'HTTPS URL required' }
    db.prepare('INSERT OR REPLACE INTO pai_ical_sources (alias, name, url, notes) VALUES (?,?,?,?)').run(i.alias, i.name || i.alias, i.url, i.notes || null)
    return { ok: true, alias: i.alias }
  }
  let _fetchIcalWarned = false
  async function fetchIcal (i) {
    let url = i.source || i.url
    if (!url) return { error: 'source (alias or https URL) required' }
    // One-time per-session notice: this tool reaches out to a URL the caller supplies.
    const FETCH_ICAL_WARNING = 'Heads up: fetch_ical retrieves an external calendar feed from a URL you provide. Only use calendar feeds you trust. Private/loopback addresses are refused.'
    const isFirstUse = !_fetchIcalWarned
    if (isFirstUse) { _fetchIcalWarned = true; try { console.log('[personal-ai] ' + FETCH_ICAL_WARNING) } catch {} }
    if (!/^https:\/\//i.test(url)) {
      const row = db.prepare('SELECT url FROM pai_ical_sources WHERE alias = ?').get(url)
      if (!row) return { error: 'unknown alias and not an https URL: ' + url }
      url = row.url
    }
    try {
      const host = new URL(url).hostname
      // SSRF guard: refuse private / loopback hosts
      if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|localhost$)/i.test(host) || host === '::1') return { error: 'refusing private/loopback host' }
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!r.ok) return { error: 'fetch failed: HTTP ' + r.status }
      const text = await r.text()
      const events = []
      let cur = null
      for (const line of text.split(/\r?\n/)) {
        if (line === 'BEGIN:VEVENT') cur = {}
        else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null }
        else if (cur) {
          const m = line.match(/^(SUMMARY|DTSTART|DTEND|LOCATION|DESCRIPTION)[^:]*:(.*)$/)
          if (m) cur[m[1].toLowerCase()] = m[2]
        }
      }
      const result = { total_events: events.length, events: events.slice(0, i.limit || 100), next_offset: null }
      // Surface the warning once per session, alongside the first successful result.
      if (isFirstUse) result.warning = FETCH_ICAL_WARNING
      return result
    } catch (e) { return { error: 'fetch error: ' + e.message } }
  }

  // ── SEARCH (outbound READ; gated on user-supplied key) ──
  async function braveSearch (query, count) {
    const key = env.BRAVE_API_KEY || env.BRAVE_SEARCH_API_KEY || ''
    if (!key) return { error: 'Brave Search API key not configured. Set BRAVE_API_KEY in this box .env to enable web search.' }
    try {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count || 5, 10)}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(12000) })
      if (!r.ok) return { error: `Brave API error ${r.status}` }
      const d = await r.json()
      return { results: (d.web?.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.description })), total: d.web?.totalEstimatedMatches }
    } catch (e) { return { error: 'search error: ' + e.message } }
  }
  async function groundedSearch (query) {
    const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || ''
    if (!key) return { error: 'Gemini API key not configured. Set GEMINI_API_KEY in this box .env to enable grounded search.' }
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: String(query) }] }], tools: [{ google_search: {} }] }), signal: AbortSignal.timeout(30000),
      })
      if (!r.ok) return { error: `Gemini API error ${r.status}` }
      const d = await r.json()
      const answer = d?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || ''
      return { answer }
    } catch (e) { return { error: 'grounded search error: ' + e.message } }
  }
  async function deepResearch (query) {
    // Async-by-contract in master; here we run grounded synchronously and return inline,
    // with a status flag so the assistant phrases it correctly.
    const res = await groundedSearch('Research deeply and structure the answer: ' + String(query))
    if (res.error) return res
    return { research_id: 'r-' + Date.now(), status: 'complete', answer: res.answer }
  }
  async function getStockQuote (symbol) {
    const key = env.ALPHAVANTAGE_API_KEY || env.STOCK_API_KEY || ''
    if (!key) return { error: 'Stock API key not configured. Set ALPHAVANTAGE_API_KEY in this box .env to enable quotes.' }
    const sym = String(symbol || '').toUpperCase().replace(/[^A-Z.]/g, '')
    if (!sym) return { error: 'valid ticker symbol required' }
    try {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${key}`, { signal: AbortSignal.timeout(12000) })
      if (!r.ok) return { error: `Stock API error ${r.status}` }
      const d = await r.json()
      const q = d['Global Quote'] || {}
      if (!q['05. price']) return { error: 'no data for symbol ' + sym }
      return { symbol: sym, price: parseFloat(q['05. price']), open: parseFloat(q['02. open']), high: parseFloat(q['03. high']), low: parseFloat(q['04. low']), volume: parseInt(q['06. volume']), as_of: q['07. latest trading day'] }
    } catch (e) { return { error: 'stock error: ' + e.message } }
  }
  function searchKnowledge (query) {
    // Offline KB module is a separate optional service. If configured, proxy to it;
    // else return an honest "not available" (never fabricate encyclopaedic content).
    const url = env.OFFLINE_KB_URL || ''
    if (!url) return { hits: [], note: 'Offline knowledge library not configured (install/activate the offline-kb module and set OFFLINE_KB_URL).' }
    return { hits: [], note: 'offline-kb proxy not wired in this build; query=' + String(query).slice(0, 80) }
  }

  // ── VISION (read images/documents with the user's OWN connected model) ──
  // capture_artefact: load image files from the sandbox into base64 PNG/JPEG pages.
  // vision_read: send those pages to the connected multimodal model and return
  // structured per-page observations. Both gate on the model key being connected.
  const VISION_MEDIA = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
  const _artefacts = new Map() // artefact_id -> [{ media_type, data }]
  function captureArtefact (i) {
    // Box-safe scope: read image files already in the drops/generated/vault sandbox.
    // (Full PDF/PPTX rasterisation needs host tooling not assumed on a public box;
    // image files pass through directly, which covers screenshots/photos/scans.)
    const rels = Array.isArray(i.paths) ? i.paths : (i.path ? [i.path] : (i.filename ? [i.filename] : []))
    if (!rels.length) return { error: 'paths (array of image filenames under store/drops, store/generated, or store/vault) required' }
    const roots = [DROPS_ROOT, GEN_ROOT, VAULT_ROOT]
    const pages = []
    for (const rel of rels) {
      let found = null
      for (const root of roots) { const f = safeJoin(root, rel); if (f && fs.existsSync(f)) { found = f; break } }
      if (!found) return { error: 'file not found in sandbox: ' + rel }
      const ext = path.extname(found).toLowerCase()
      const mt = VISION_MEDIA[ext]
      if (!mt) return { error: 'unsupported file type for visual read (image files only): ' + rel }
      pages.push({ media_type: mt, data: fs.readFileSync(found).toString('base64') })
    }
    const artefact_id = 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
    _artefacts.set(artefact_id, pages)
    return { artefact_id, page_count: pages.length, note: 'Loaded ' + pages.length + ' page image(s). Call vision_read with this artefact_id.' }
  }
  async function visionRead (i) {
    if (!modelReady()) return { error: MODEL_NOT_CONNECTED }
    let pages = null
    if (i.artefact_id && _artefacts.has(i.artefact_id)) pages = _artefacts.get(i.artefact_id)
    else if (Array.isArray(i.images)) pages = i.images.map(x => ({ media_type: x.media_type || 'image/png', data: x.data })).filter(p => p.data)
    else { const cap = captureArtefact(i); if (cap.error) return cap; pages = _artefacts.get(cap.artefact_id) }
    if (!pages || !pages.length) return { error: 'no page images to read (provide artefact_id from capture_artefact, or paths)' }
    const out = []
    const batch = pages.slice(0, 16)
    for (let n = 0; n < batch.length; n++) {
      try {
        const text = await model.vision({
          system: 'You read a single document/image page. Reply ONLY with compact JSON: {"text_extracted": "<verbatim text>", "layout_summary": "<short>", "visible_errors": ["<any>"]}',
          user: 'Read page ' + (n + 1) + '. Extract all text, summarise layout, list any visible errors. JSON only.',
          images: [batch[n]],
        })
        let parsed = null
        try { parsed = JSON.parse(String(text).replace(/^```(json)?/i, '').replace(/```$/, '').trim()) } catch {}
        out.push({ page_num: n + 1, text_extracted: parsed?.text_extracted ?? String(text), layout_summary: parsed?.layout_summary ?? '', visible_errors: parsed?.visible_errors ?? [] })
      } catch (e) {
        if (e && e.code === 'NO_VISION_KEY') return { error: e.message }
        out.push({ page_num: n + 1, text_extracted: '', layout_summary: '', visible_errors: ['read failed: ' + String(e && e.message || e).slice(0, 120)] })
      }
    }
    return { artefact_id: i.artefact_id || null, pages: out, total_pages: out.length, note: 'Read with your connected model (may incur API cost).' }
  }

  // ── BOOK pipeline WRITE tools (generated with the user's OWN connected model) ──
  function bookRow (id) { return db.prepare('SELECT * FROM pai_books WHERE id = ?').get(id) }
  function bookTouch (id) { db.prepare('UPDATE pai_books SET updated_at = unixepoch() WHERE id = ?').run(id) }
  async function bookResearch (i) {
    const topic = String(i.topic || '').trim()
    if (!topic) return { error: 'topic required' }
    const r = db.prepare('INSERT INTO pai_books (topic, status) VALUES (?, ?)').run(topic, 'researching')
    const book_id = Number(r.lastInsertRowid)
    const res = await modelText(
      'You are a non-fiction book strategist. Output a concise research brief.',
      'Research this book topic for self-publishing: "' + topic + '". Cover: likely competitor titles, keyword/positioning opportunities, the target reader, and a suggested chapter outline. Be specific and practical.',
      3000)
    if (res.__model_error) { db.prepare('UPDATE pai_books SET status = ? WHERE id = ?').run('drafting', book_id); return { book_id, status: 'needs_model', message: res.__model_error } }
    db.prepare('UPDATE pai_books SET research = ?, status = ?, updated_at = unixepoch() WHERE id = ?').run(res.text, 'researched', book_id)
    return { book_id, status: 'complete', research: res.text, note: 'Generated with your connected model (may incur API cost).' }
  }
  function bookSetResearch (i) {
    const id = i.book_id; if (!id || !bookRow(id)) return { error: 'unknown book_id' }
    if (!i.research) return { error: 'research text required' }
    db.prepare('UPDATE pai_books SET research = ?, status = ?, updated_at = unixepoch() WHERE id = ?').run(String(i.research), 'researched', id)
    return { book_id: id, ok: true }
  }
  async function bookOutline (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row && !i.topic) return { error: 'book_id (from book_research) or topic required' }
    const topic = row ? row.topic : String(i.topic)
    const research = row?.research || i.research || ''
    const res = await modelText(
      'You are a book editor. Reply ONLY with JSON: {"title","subtitle","tagline","chapters":[{"n","title","word_target","summary"}]}.',
      'Create a chapter outline for a book on "' + topic + '".' + (research ? '\n\nResearch:\n' + research.slice(0, 4000) : '') + '\n\nJSON only.',
      3000)
    if (res.__model_error) return { status: 'needs_model', message: res.__model_error }
    let parsed = null
    try { parsed = JSON.parse(String(res.text).replace(/^```(json)?/i, '').replace(/```$/, '').trim()) } catch {}
    const bid = id || Number(db.prepare('INSERT INTO pai_books (topic, status) VALUES (?, ?)').run(topic, 'outlined').lastInsertRowid)
    db.prepare('UPDATE pai_books SET title = ?, subtitle = ?, outline = ?, status = ?, updated_at = unixepoch() WHERE id = ?')
      .run(parsed?.title || null, parsed?.subtitle || null, res.text, 'outlined', bid)
    return { book_id: bid, status: 'complete', outline: parsed || res.text, note: 'Generated with your connected model (may incur API cost).' }
  }
  async function bookWriteChapter (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row) return { error: 'unknown book_id (call book_outline first)' }
    const chapter_n = parseInt(i.chapter_n, 10)
    if (!Number.isFinite(chapter_n) || chapter_n < 1) return { error: 'chapter_n (>=1) required' }
    const prev = db.prepare('SELECT chapter_n, content FROM pai_book_chapters WHERE book_id = ? AND chapter_n < ? ORDER BY chapter_n DESC LIMIT 1').get(id, chapter_n)
    const styleHint = prev ? '\n\nFor style continuity, here is the end of the previous chapter:\n' + String(prev.content).slice(-1200) : ''
    const res = await modelText(
      'You are a professional non-fiction author. Write clean, publishable prose. No meta commentary.',
      'Book: "' + (row.title || row.topic) + '".\nOutline:\n' + String(row.outline || '').slice(0, 3000) + '\n\nWrite chapter ' + chapter_n + (i.title ? ' titled "' + i.title + '"' : '') + ' in full.' + styleHint,
      6000)
    if (res.__model_error) return { status: 'needs_model', message: res.__model_error }
    const wc = String(res.text).split(/\s+/).filter(Boolean).length
    db.prepare('INSERT OR REPLACE INTO pai_book_chapters (book_id, chapter_n, title, content, word_count, updated_at) VALUES (?,?,?,?,?,unixepoch())')
      .run(id, chapter_n, i.title || ('Chapter ' + chapter_n), res.text, wc)
    db.prepare('UPDATE pai_books SET status = ?, updated_at = unixepoch() WHERE id = ?').run('writing', id)
    return { book_id: id, chapter_n, word_count: wc, content: res.text, note: 'Generated with your connected model (may incur API cost).' }
  }
  async function bookListingGenerate (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row) return { error: 'unknown book_id' }
    const res = await modelText(
      'You write sales listings for self-published books. Reply ONLY with JSON: {"title","subtitle","description","keywords":[7],"categories":[2],"suggested_price"}.',
      'Write a marketplace listing for "' + (row.title || row.topic) + '".\nOutline:\n' + String(row.outline || '').slice(0, 2500) + '\n\nDescription up to 4000 chars. JSON only.',
      3000)
    if (res.__model_error) return { status: 'needs_model', message: res.__model_error }
    db.prepare('UPDATE pai_books SET listing = ?, updated_at = unixepoch() WHERE id = ?').run(res.text, id)
    let parsed = null; try { parsed = JSON.parse(String(res.text).replace(/^```(json)?/i, '').replace(/```$/, '').trim()) } catch {}
    return { book_id: id, listing: parsed || res.text, note: 'Generated with your connected model (may incur API cost).' }
  }
  function bookAssemble (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row) return { error: 'unknown book_id' }
    const chapters = db.prepare('SELECT chapter_n, title, content FROM pai_book_chapters WHERE book_id = ? ORDER BY chapter_n').all(id)
    if (!chapters.length) return { error: 'no chapters written yet (call book_write_chapter first)' }
    const paras = []
    if (row.title) paras.push(row.title)
    if (row.subtitle) paras.push(row.subtitle)
    for (const c of chapters) {
      paras.push(c.title || ('Chapter ' + c.chapter_n))
      for (const p of String(c.content).split(/\n+/)) if (p.trim()) paras.push(p.trim())
    }
    const base = (String(row.title || row.topic).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'book')
    const docxName = base + '.docx'
    fs.writeFileSync(path.join(GEN_ROOT, docxName), buildDocx(paras))
    db.prepare('UPDATE pai_books SET status = ?, updated_at = unixepoch() WHERE id = ?').run('assembled', id)
    return { book_id: id, files: [{ kind: 'docx', filename: docxName, path: path.join(GEN_ROOT, docxName) }], chapters: chapters.length, note: 'Print-ready manuscript assembled (DOCX). EPUB export not generated on a stock box.' }
  }
  function bookStatus (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row) return { error: 'unknown book_id' }
    const chapters = db.prepare('SELECT chapter_n, title, word_count FROM pai_book_chapters WHERE book_id = ? ORDER BY chapter_n').all(id)
    const words = chapters.reduce((s, c) => s + (c.word_count || 0), 0)
    return { book_id: id, topic: row.topic, title: row.title, subtitle: row.subtitle, status: row.status, chapters_written: chapters.length, total_words: words, has_outline: !!row.outline, has_listing: !!row.listing }
  }
  function bookList (i) {
    const rows = i.status ? db.prepare('SELECT id, topic, title, status FROM pai_books WHERE status = ? ORDER BY id DESC').all(i.status) : db.prepare('SELECT id, topic, title, status FROM pai_books ORDER BY id DESC').all()
    return { books: rows }
  }

  // ── IMAGE generation tools (use the user's OWN connected image model -- Gemini) ──
  // All save real image bytes into the sandbox (store/generated, or a per-book subdir).
  // When no image model is connected they return a friendly "set GEMINI_API_KEY" message
  // (status needs_image_model) -- never a crash, never a fabricated image.
  async function generateImage (i) {
    const prompt = String(i.prompt || '').trim()
    if (!prompt) return { error: 'prompt required (describe the image to generate)' }
    const res = await modelImageToFile(prompt, { basename: i.name || 'image' })
    if (res.__image_error) return { status: 'needs_image_model', message: res.__image_error }
    if (res.error) return res
    return { status: 'complete', filename: res.filename, path: res.rel, media_type: res.media_type, note: 'Generated with your connected image model (Gemini); may incur API cost.' }
  }
  async function generateDesign (i) {
    // Image-producing design tool (logos, social graphics, simple layouts). Same backend
    // as generate_image; the prompt is shaped toward a clean, flat, print/screen-safe design.
    const brief = String(i.prompt || i.brief || '').trim()
    if (!brief) return { error: 'prompt/brief required (describe the design to generate)' }
    const kind = String(i.kind || 'design').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'design'
    const styled = 'Design a clean, professional ' + kind + ': ' + brief +
      '. Flat, uncluttered, high-contrast, suitable for screen and print. No watermark, no placeholder text.'
    const res = await modelImageToFile(styled, { basename: kind })
    if (res.__image_error) return { status: 'needs_image_model', message: res.__image_error }
    if (res.error) return res
    return { status: 'complete', kind, filename: res.filename, path: res.rel, media_type: res.media_type, note: 'Generated with your connected image model (Gemini); may incur API cost.' }
  }
  async function bookCoverGenerate (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row) return { error: 'unknown book_id (call book_outline first)' }
    if (!imageReady()) return { status: 'needs_image_model', message: IMAGE_NOT_CONNECTED }
    const title = row.title || row.topic
    const subtitle = row.subtitle || ''
    const variants = Math.min(Math.max(parseInt(i.variants, 10) || 3, 1), 3)
    const subdir = 'books/book-' + id + '/covers'
    const guidance = String(i.style || '').trim()
    const files = []
    for (let n = 0; n < variants; n++) {
      const prompt = 'Design a professional, market-ready book cover for the book titled "' + title + '"' +
        (subtitle ? ' with the subtitle "' + subtitle + '"' : '') + '. Topic: ' + row.topic + '. ' +
        (guidance ? 'Style: ' + guidance + '. ' : '') +
        'Portrait orientation, strong title typography, eye-catching but tasteful, suitable for a self-published listing thumbnail. Variant ' + (n + 1) + '.'
      const res = await modelImageToFile(prompt, { subdir, basename: 'cover-v' + (n + 1) })
      if (res.__image_error) {
        // No image model: report cleanly. If some variants already saved, return those.
        if (!files.length) return { status: 'needs_image_model', message: res.__image_error }
        break
      }
      if (res.error) { if (!files.length) return res; break }
      files.push({ variant: n + 1, filename: res.filename, path: res.rel, media_type: res.media_type })
    }
    if (!files.length) return { status: 'needs_image_model', message: IMAGE_NOT_CONNECTED }
    return { book_id: id, status: 'complete', covers: files, count: files.length, note: 'Cover variants saved to your sandbox (' + subdir + '). Review and pick one. Uses your connected image model (Gemini); may incur API cost.' }
  }
  async function bookInteriorGraphics (i) {
    const id = i.book_id; const row = id ? bookRow(id) : null
    if (!row) return { error: 'unknown book_id' }
    const brief = String(i.prompt || i.description || '').trim()
    if (!brief) return { error: 'prompt/description required (what diagram or illustration to generate)' }
    if (!imageReady()) return { status: 'needs_image_model', message: IMAGE_NOT_CONNECTED }
    const subdir = 'books/book-' + id + '/interior'
    const chapterTag = i.chapter_n != null ? ('ch' + parseInt(i.chapter_n, 10)) : 'fig'
    const prompt = 'Create a print-safe interior illustration or diagram for a book: ' + brief +
      '. Clean black-and-white or minimal colour, high contrast, no photographic noise, suitable for print interior pages.'
    const res = await modelImageToFile(prompt, { subdir, basename: chapterTag })
    if (res.__image_error) return { status: 'needs_image_model', message: res.__image_error }
    if (res.error) return res
    return { book_id: id, status: 'complete', graphic: { filename: res.filename, path: res.rel, media_type: res.media_type }, note: 'Interior graphic saved to your sandbox (' + subdir + '). Uses your connected image model (Gemini); may incur API cost.' }
  }

  // ── registry: name -> executor. ONLY box-safe tools appear here. ──
  const EXECUTORS = {
    // memory
    save_memory: (i) => saveMemory(i.content, i.category, { supersedes_id: i.supersedes_id, importance_tier: i.importance_tier }),
    recall_memory: (i) => recallMemory(i.query),
    update_memory: (i) => updateMemory(i.id, i.content, i.category),
    delete_memory: (i) => deleteMemory(i.id),
    // tasks
    get_tasks: (i) => getTasks(i.status),
    add_task: (i) => addTask(i.title, i.notes, i.due_date, i.priority, i.company),
    update_task: (i) => updateTask(i.id, i),
    // contacts
    search_contacts: (i) => searchContacts(i.query),
    add_contact: (i) => addContact(i),
    update_contact: (i) => updateContact(i.id, i),
    delete_contact: (i) => deleteContact(i.id),
    // important list
    important_list_read: () => importantListRead(),
    important_list_add: (i) => importantListAdd(i.item, i.source),
    important_list_remove: (i) => importantListRemove(i.index),
    // commitments
    commitment_add: (i) => commitmentAdd(i.description, i.due_date, i.party, i.direction, i.notes),
    commitment_list: (i) => commitmentList(i.status),
    commitment_done: (i) => commitmentDone(i.id, i.notes),
    // graph
    graph_upsert_entity: (i) => graphUpsertEntity(i.entity_type, i.name, i.canonical, i.metadata),
    graph_upsert_relationship: (i) => graphUpsertRelationship(i.from_id, i.to_id, i.rel_type, i.strength),
    graph_find_entity: (i) => graphFindEntity(i.name, i.type),
    graph_find_person: (i) => graphFindPerson(i.name),
    // places
    place_upsert: (i) => placeUpsert(i.name, i.lat, i.lng, i.radius_m, i.canonical),
    place_list: () => placeList(),
    place_delete: (i) => placeDelete(i.id),
    // schedule
    schedule_task: (i) => scheduleTask(i.prompt, i.scheduled_for, i.label),
    schedule_list: () => scheduleList(),
    // vault
    vault_read: (i) => vaultRead(i.path),
    vault_write: (i) => vaultWrite(i.path, i.content),
    vault_search: (i) => vaultSearch(i.query, i.max_results),
    vault_list: (i) => vaultList(i.dir),
    // drops / files
    save_file: (i) => saveDropFile(i),
    list_drops: (i) => listDrops(i.query),
    read_drop_file: (i) => readDropFile(i.filename),
    delete_drop_file: (i) => deleteDropFile(i.filename),
    delete_drops_batch: (i) => deleteDropsBatch(i.filenames),
    rename_drop_file: (i) => renameDropFile(i.old_filename, i.new_filename),
    // generate (local)
    generate_pdf: (i) => generatePdf(i),
    generate_docx: (i) => generateDocx(i),
    generate_xlsx: (i) => generateXlsx(i),
    // ical
    ical_list_sources: () => icalListSources(),
    ical_register_source: (i) => icalRegisterSource(i),
    fetch_ical: (i) => fetchIcal(i),
    // search (gated on key)
    brave_search: (i) => braveSearch(i.query, i.count),
    grounded_search: (i) => groundedSearch(i.query),
    deep_research: (i) => deepResearch(i.query),
    get_stock_quote: (i) => getStockQuote(i.symbol),
    search_knowledge: (i) => searchKnowledge(i.query),
    // vision (uses the user's connected multimodal model; may incur API cost)
    capture_artefact: (i) => captureArtefact(i),
    vision_read: (i) => visionRead(i),
    // book pipeline WRITE tools (use the user's connected model; may incur API cost)
    book_research: (i) => bookResearch(i),
    book_set_research: (i) => bookSetResearch(i),
    book_outline: (i) => bookOutline(i),
    book_write_chapter: (i) => bookWriteChapter(i),
    book_listing_generate: (i) => bookListingGenerate(i),
    book_assemble: (i) => bookAssemble(i),
    book_status: (i) => bookStatus(i),
    book_list: (i) => bookList(i),
    // image generation (use the user's connected image model -- Gemini; may incur API cost)
    generate_image: (i) => generateImage(i),
    generate_design: (i) => generateDesign(i),
    book_cover_generate: (i) => bookCoverGenerate(i),
    book_interior_graphics: (i) => bookInteriorGraphics(i),
  }

  return {
    names: () => Object.keys(EXECUTORS),
    has: (name) => Object.prototype.hasOwnProperty.call(EXECUTORS, name),
    run: async (name, input) => {
      const fn = EXECUTORS[name]
      if (!fn) return { error: 'no executor for tool: ' + name }
      try { return await fn(input || {}) } catch (e) { return { error: String(e && e.message || e) } }
    },
    paths: { VAULT_ROOT, DROPS_ROOT, GEN_ROOT, STATE_DIR },
  }
}
