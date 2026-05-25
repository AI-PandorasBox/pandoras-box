#!/usr/bin/env node
// pbox-import.mjs -- import existing memories from another assistant into your
// Personal Assistant's memory (the important_facts table of memory.db).
//
//   pbox-import --from jsonl     --path chats.jsonl            [--dry-run] [--tag june]
//   pbox-import --from markdown  --path notes.md               [--dry-run]
//   pbox-import --from claude-desktop|openclaw|hermes --path … (export to JSONL first; see README)
//   pbox-import --undo <tag>     # remove a previous import batch
//
// SECURITY (v1): LOCAL FILES ONLY. No network egress, no new credentials, no
// child processes. All input is treated as untrusted DATA (never executed).
// Size/volume capped. Every import is reversible via its batch manifest.
// _DATA_IMPORT_V1
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MAX_FILE_BYTES = 50 * 1024 * 1024   // 50 MB input cap
const MAX_RECORDS_DEFAULT = 5000
const MAX_TEXT = 4000                      // per-fact char cap

function die(msg, code = 1) { console.error('pbox-import: ' + msg); process.exit(code) }

// ---- args ----
const args = process.argv.slice(2)
const opt = { from: null, path: null, store: null, target: 'facts', tag: null, limit: MAX_RECORDS_DEFAULT, dryRun: false, undo: null }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--from') opt.from = args[++i]
  else if (a === '--path') opt.path = args[++i]
  else if (a === '--store') opt.store = args[++i]
  else if (a === '--target') opt.target = args[++i]
  else if (a === '--tag') opt.tag = args[++i]
  else if (a === '--limit') opt.limit = Math.max(1, parseInt(args[++i], 10) || MAX_RECORDS_DEFAULT)
  else if (a === '--dry-run') opt.dryRun = true
  else if (a === '--undo') opt.undo = args[++i]
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
}

function printHelp() {
  console.log(`pbox-import -- import memories into your Personal Assistant.
  --from <claude-desktop|openclaw|hermes|jsonl|markdown>
  --path <file>            source export to read (local file only)
  --store <dir>            dir containing memory.db (default: auto-detect)
  --tag <name>             label this batch (enables --undo); default: timestamp
  --dry-run                preview only, write nothing
  --limit N                cap records (default ${MAX_RECORDS_DEFAULT})
  --undo <tag>             remove a previously imported batch`)
}

// ---- resolve memory.db ----
function resolveMemoryDb() {
  if (opt.store) return path.join(opt.store, 'memory.db')
  if (process.env.PBOX_MEMORY_DB) return process.env.PBOX_MEMORY_DB
  const base = process.env.INSTALL_PATH || '/opt/pandoras-box'
  for (const p of [path.join(base, 'personal-ai', 'store', 'memory.db'),
                   path.join(base, 'data', 'personal-ai', 'memory.db')]) {
    if (fs.existsSync(p)) return p
  }
  return path.join(base, 'personal-ai', 'store', 'memory.db')
}
const MEMORY_DB = resolveMemoryDb()
const IMPORTS_DIR = path.join(path.dirname(MEMORY_DB), 'imports')

// ---- undo ----
if (opt.undo) {
  const man = path.join(IMPORTS_DIR, opt.undo + '.json')
  if (!fs.existsSync(man)) die(`no import batch "${opt.undo}" (looked for ${man})`)
  const m = JSON.parse(fs.readFileSync(man, 'utf8'))
  if (!fs.existsSync(MEMORY_DB)) die(`memory.db not found at ${MEMORY_DB}`)
  const db = new DatabaseSync(MEMORY_DB)
  const del = db.prepare('DELETE FROM important_facts WHERE id = ?')
  let n = 0
  for (const id of (m.ids || [])) { try { del.run(id); n++ } catch {} }
  db.close()
  fs.rmSync(man)
  console.log(`Removed ${n} imported facts from batch "${opt.undo}".`)
  process.exit(0)
}

// ---- read source (size-capped, untrusted data) ----
if (!opt.from) die('missing --from')
if (!opt.path) die('missing --path')
if (!fs.existsSync(opt.path)) die(`file not found: ${opt.path}`)
const st = fs.statSync(opt.path)
if (st.isFile() && st.size > MAX_FILE_BYTES) die(`file too large (${(st.size/1048576).toFixed(1)} MB > 50 MB cap)`)

function readText(p) { return fs.readFileSync(p, 'utf8') }

// ---- adapters: source -> [{text, ts}] ----
function fromJsonl(p) {
  const raw = readText(p).trim()
  const out = []
  const push = (obj) => {
    if (typeof obj === 'string') { out.push({ text: obj }); return }
    if (!obj || typeof obj !== 'object') return
    const text = obj.text || obj.content || obj.message || obj.body ||
                 (obj.role && obj.content ? `${obj.role}: ${obj.content}` : null)
    if (text) out.push({ text: String(text), ts: obj.ts || obj.created_at || obj.timestamp || null })
  }
  if (raw.startsWith('[')) { for (const e of JSON.parse(raw)) push(e) }       // JSON array
  else for (const line of raw.split('\n')) { if (line.trim()) { try { push(JSON.parse(line)) } catch { push(line) } } } // NDJSON / plain lines
  return out
}
function fromMarkdown(p) {
  return readText(p).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(text => ({ text }))
}
function stub(name) {
  die(`the "${name}" native format is not yet wired (its export shape needs confirming).\n` +
      `  For now: export your ${name} data to JSONL (one {"text": "..."} per line) and run:\n` +
      `    pbox-import --from jsonl --path your-export.jsonl`, 2)
}

let records
switch (opt.from) {
  case 'jsonl': records = fromJsonl(opt.path); break
  case 'markdown': records = fromMarkdown(opt.path); break
  case 'claude-desktop': stub('claude-desktop'); break
  case 'openclaw': stub('openclaw'); break
  case 'hermes': stub('hermes'); break
  default: die(`unknown --from "${opt.from}" (claude-desktop|openclaw|hermes|jsonl|markdown)`)
}

// normalise: trim, cap length, drop empties, cap count
records = records
  .map(r => ({ text: String(r.text || '').trim().slice(0, MAX_TEXT) }))
  .filter(r => r.text.length > 0)
  .slice(0, opt.limit)

if (records.length === 0) die('no importable records found in the source.', 0)

console.log(`Parsed ${records.length} record(s) from ${opt.from} (${opt.path}).`)
console.log('Sample:')
for (const r of records.slice(0, 3)) console.log('  - ' + r.text.replace(/\s+/g, ' ').slice(0, 100))

if (opt.dryRun) { console.log(`\n[dry-run] nothing written. Re-run without --dry-run to import into ${MEMORY_DB}.`); process.exit(0) }

// ---- write into memory.db (important_facts), tracked for undo ----
if (opt.target !== 'facts') die(`--target "${opt.target}" not supported in v1 (only "facts")`)
fs.mkdirSync(IMPORTS_DIR, { recursive: true })
const tag = (opt.tag || new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)).replace(/[^A-Za-z0-9_-]/g, '')
const manPath = path.join(IMPORTS_DIR, tag + '.json')
if (fs.existsSync(manPath)) die(`batch "${tag}" already exists; choose another --tag or --undo it first.`)

const db = new DatabaseSync(MEMORY_DB)
db.prepare('CREATE TABLE IF NOT EXISTS important_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL, created_at INTEGER, source_message_id INTEGER)').run()
const ins = db.prepare('INSERT INTO important_facts (fact, created_at, source_message_id) VALUES (?, ?, NULL)')
const ids = []
const now = Date.now()
for (const r of records) { const res = ins.run(r.text, now); ids.push(Number(res.lastInsertRowid)) }
db.close()

fs.writeFileSync(manPath, JSON.stringify({ tag, from: opt.from, source: opt.path, count: ids.length, ids, at: new Date().toISOString() }, null, 2))
fs.chmodSync(manPath, 0o600)
console.log(`\nImported ${ids.length} memories into ${MEMORY_DB} (batch "${tag}").`)
console.log(`Undo any time with:  pbox-import --undo ${tag}`)
