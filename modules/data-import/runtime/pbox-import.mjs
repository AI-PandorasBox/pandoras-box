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
  --from <obsidian|claude-desktop|openclaw|hermes|jsonl|markdown>
  --path <file|vault>      source file, or an Obsidian vault folder (--from obsidian)
  --store <dir>            dir containing memory.db (default: auto-detect)
  --target facts|kb|both   facts = assistant memory (default); kb = vector-kb semantic memory
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
// vector-kb sink (localhost only -- no external egress)
const VECTOR_KB_URL = (process.env.VECTOR_KB_URL || 'http://127.0.0.1:8486').replace(/\/$/, '')
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(VECTOR_KB_URL)) die('VECTOR_KB_URL must be localhost (no external egress)')

// ---- undo ----
if (opt.undo) {
  const man = path.join(IMPORTS_DIR, opt.undo + '.json')
  if (!fs.existsSync(man)) die(`no import batch "${opt.undo}" (looked for ${man})`)
  const m = JSON.parse(fs.readFileSync(man, 'utf8'))
  let n = 0
  const factIds = [].concat(m.facts || [], m.ids || [])   // m.ids = older manifest format
  if (factIds.length && fs.existsSync(MEMORY_DB)) {
    const db = new DatabaseSync(MEMORY_DB)
    const del = db.prepare('DELETE FROM important_facts WHERE id = ?')
    for (const id of factIds) { try { del.run(id); n++ } catch {} }
    db.close()
  }
  for (const id of (m.kb || [])) {
    try { await fetch(`${VECTOR_KB_URL}/item?id=${id}`, { method: 'DELETE' }); n++ } catch {}
  }
  fs.rmSync(man)
  console.log(`Removed ${n} imported memories from batch "${opt.undo}".`)
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
// Obsidian vault: walk a folder of .md notes; one fact per note (title + body),
// frontmatter stripped, [[wikilinks]] flattened, ![[embeds]] dropped.
function noteToRecord(fp, raw) {
  let body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '')          // YAML frontmatter
                .replace(/!\[\[[^\]]*\]\]/g, '')                 // embeds
                .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')   // [[target|alias]] -> alias
                .replace(/\[\[([^\]]+)\]\]/g, '$1')              // [[target]] -> target
                .trim()
  if (!body) return null
  const title = path.basename(fp).replace(/\.md$/i, '')
  return { text: `${title}: ${body}` }
}
function fromObsidian(p) {
  if (fs.statSync(p).isFile()) { const r = noteToRecord(p, readText(p)); return r ? [r] : [] }
  const skip = new Set(['.obsidian', '.trash', '.git', 'node_modules'])
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= opt.limit) return
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(d, e.name)) }
      else if (e.isFile() && /\.md$/i.test(e.name)) {
        const fp = path.join(d, e.name)
        let st; try { st = fs.statSync(fp) } catch { continue }
        if (st.size > 1024 * 1024) continue   // skip notes > 1 MB
        const r = noteToRecord(fp, readText(fp))
        if (r) out.push(r)
      }
    }
  }
  walk(p)
  return out
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
  case 'obsidian': records = fromObsidian(opt.path); break
  case 'claude-desktop': stub('claude-desktop'); break
  case 'openclaw': stub('openclaw'); break
  case 'hermes': stub('hermes'); break
  default: die(`unknown --from "${opt.from}" (obsidian|claude-desktop|openclaw|hermes|jsonl|markdown)`)
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

// ---- write to the chosen store(s), tracked for undo ----
const doFacts = opt.target === 'facts' || opt.target === 'both'
const doKb = opt.target === 'kb' || opt.target === 'both'
if (!doFacts && !doKb) die(`--target "${opt.target}" must be facts | kb | both`)

fs.mkdirSync(IMPORTS_DIR, { recursive: true })
const tag = (opt.tag || new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)).replace(/[^A-Za-z0-9_-]/g, '')
const manPath = path.join(IMPORTS_DIR, tag + '.json')
if (fs.existsSync(manPath)) die(`batch "${tag}" already exists; choose another --tag or --undo it first.`)
const manifest = { tag, from: opt.from, source: opt.path, target: opt.target, at: new Date().toISOString(), facts: [], kb: [] }

if (doFacts) {
  const db = new DatabaseSync(MEMORY_DB)
  db.prepare('CREATE TABLE IF NOT EXISTS important_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT NOT NULL, created_at INTEGER, source_message_id INTEGER)').run()
  const ins = db.prepare('INSERT INTO important_facts (fact, created_at, source_message_id) VALUES (?, ?, NULL)')
  const now = Date.now()
  for (const r of records) manifest.facts.push(Number(ins.run(r.text, now).lastInsertRowid))
  db.close()
}

if (doKb) {
  const payload = records.map(r => ({ text: r.text, source: opt.from }))
  for (let i = 0; i < payload.length; i += 100) {
    const chunk = payload.slice(i, i + 100)
    let res
    try { res = await fetch(`${VECTOR_KB_URL}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: chunk }) }) }
    catch (e) { die(`could not reach vector-kb at ${VECTOR_KB_URL} (install + start the vector-kb module first): ${e.message}`) }
    if (!res.ok) die(`vector-kb /ingest returned ${res.status}`)
    const j = await res.json()
    if (Array.isArray(j.ids)) manifest.kb.push(...j.ids)
  }
}

fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2))
fs.chmodSync(manPath, 0o600)
console.log(`\nImported ${manifest.facts.length} fact(s) + ${manifest.kb.length} vector(s) (batch "${tag}").`)
console.log(`Undo any time with:  pbox-import --undo ${tag}`)
