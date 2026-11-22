#!/usr/bin/env node
// morpheus-consolidate.mjs -- _MORPHEUS_V2_CONSOLIDATE
// Our own "Dreams" (after Anthropic's Managed Agents Dreams): tidy an agent's memory store between
// sessions -- duplicates, restatements, superseded facts -- WITHOUT deleting or rewriting anything.
//
//   node morpheus-consolidate.mjs report  [--db PATH] [--max N]   # propose only (default)
//   node morpheus-consolidate.mjs apply   [--db PATH] [--max N]   # propose + retire redundant rows
//   node morpheus-consolidate.mjs undo    --run RUN_ID            # restore every row a run retired
//
// How:  1) exact copies (normalised text) -> keep the most-used/newest, retire the rest (no LLM)
//       2) local embeddings (Ollama nomic-embed-text) -> near-duplicate clusters (cos >= 0.93)
//          and same-category topic pairs (0.86..0.93) -> Claude (via the Pbox bridge) judges each:
//          duplicate | superseded | distinct | conflict
//       3) "retire" = SET invalid_at (recall already ignores invalid rows; nothing is deleted).
//          Every change is logged per run in morpheus_undo, so `undo` puts it all back.
//       Conflicts are NEVER auto-resolved: they go to the review list for Zeus.
// email_context is excluded (a retention-policy question; reported only).
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const MODE = args[0] || 'report'
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const DB = opt('--db', process.env.MORPHEUS_DB || '')
const OUT = opt('--out', process.env.MORPHEUS_OUT || './morpheus-reports')
const MAX = Number(opt('--max', '40'))                 // candidate groups judged per run (bounded cost)
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434') + '/api/embed'
const EMBED_MODEL = process.env.MORPHEUS_EMBED_MODEL || 'nomic-embed-text'
const ADAPTER = process.env.MORPHEUS_ADAPTER || ''
// Categories worth judging (comma list). Deployments add their own, e.g. MORPHEUS_CATEGORIES=fact,decision,...
const JUDGE_CATS = new Set((process.env.MORPHEUS_CATEGORIES || 'fact,decision,preference,project,plan,task,finance,general,zeus_instruction')
  .split(',').map(x => x.trim()).filter(Boolean))
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '-' + randomUUID().slice(0, 6)
const norm = (t) => t.toLowerCase().replace(/\W+/g, ' ').trim()

function ensureUndo (db) {
  db.exec('CREATE TABLE IF NOT EXISTS morpheus_undo (run TEXT, memory_id INTEGER, kept_id INTEGER, reason TEXT, at INTEGER)')
  // _MEMORY_ARCHIVE_V1: every retired memory also gets a readable archive record (text, dates, reason, tags)
  db.exec(`CREATE TABLE IF NOT EXISTS memory_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL,
    content TEXT NOT NULL, category TEXT, created_at INTEGER, archived_at INTEGER NOT NULL, reason TEXT NOT NULL,
    tags TEXT, kept_id INTEGER, source TEXT NOT NULL, UNIQUE (memory_id, source))`)
}

if (MODE === 'undo') {
  const run = opt('--run')
  if (!run) throw new Error('--run RUN_ID required')
  const db = new DatabaseSync(DB)
  ensureUndo(db)
  const ids = db.prepare('SELECT memory_id FROM morpheus_undo WHERE run=?').all(run)
  for (const r of ids) db.prepare('UPDATE memories SET invalid_at=NULL WHERE id=?').run(r.memory_id)
  db.prepare("UPDATE memory_archive SET reason = reason || ' [RESTORED ' || date('now') || ']', tags = tags || ',restored' WHERE source=?").run(run)
  db.prepare('UPDATE morpheus_undo SET reason = reason || \' [UNDONE]\' WHERE run=?').run(run)
  console.log(`[morpheus] undo ${run}: restored ${ids.length} memories`)
  process.exit(0)
}

// --files DIR: a file-based memory (Zeus's markdown memory). Always report-only: a person edits files.
const FILES = opt('--files')
if (FILES && MODE === 'apply') throw new Error('--files is report-only')
if (!FILES && !DB) throw new Error('no memory database: pass --db PATH or set MORPHEUS_DB (or --files DIR)')
let db = null
let rows
if (FILES) {
  rows = readdirSync(FILES).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').map((f, i) => {
    const raw = readFileSync(`${FILES}/${f}`, 'utf8')
    const body = raw.replace(/^---[\s\S]*?---\n/, '')
    const typ = (raw.match(/type:\s*(\w+)/) || [])[1] || 'general'
    return { id: i + 1, file: f, content: `${f}: ${body.trim()}`, category: 'fact', created_at: Math.floor(statSync(`${FILES}/${f}`).mtimeMs / 1000), refs: 0, kind: typ }
  })
} else {
  db = new DatabaseSync(DB, { readOnly: MODE !== 'apply' })
  rows = db.prepare(`SELECT id, content, category, created_at, accessed_at, reference_count AS refs
    FROM memories WHERE invalid_at IS NULL OR invalid_at > unixepoch()`).all()
}
const byId = new Map(rows.map(r => [r.id, r]))
const better = (a, b) => (b.refs - a.refs) || (b.created_at - a.created_at)   // keep most-used, then newest
const plan = { run: RUN, mode: MODE, db: DB, total: rows.length, retire: [], conflicts: [], distinct: 0, judged: 0, cost_usd: 0 }

// 1) exact copies
const groups = new Map()
for (const r of rows) { const k = norm(r.content); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) }
for (const g of groups.values()) {
  if (g.length < 2) continue
  const s = [...g].sort(better)
  for (const r of s.slice(1)) plan.retire.push({ id: r.id, keep: s[0].id, reason: 'exact copy', category: r.category })
}
const retired = new Set(plan.retire.map(x => x.id))

// 2) local embeddings -> candidate groups
const items = rows.filter(r => JUDGE_CATS.has(r.category) && !retired.has(r.id))
async function embed (texts) {
  const r = await fetch(OLLAMA, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }) })
  if (!r.ok) throw new Error('ollama ' + r.status)
  return (await r.json()).embeddings
}
const V = []
for (let i = 0; i < items.length; i += 64) V.push(...await embed(items.slice(i, i + 64).map(r => r.content.slice(0, 2000))))
for (const v of V) { const n = Math.hypot(...v); for (let k = 0; k < v.length; k++) v[k] /= n }
const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s }
const parent = items.map((_, i) => i)
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
const pairs = []
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const s = dot(V[i], V[j])
    if (s >= 0.93) parent[find(i)] = find(j)
    else if (s >= 0.86 && items[i].category === items[j].category) pairs.push([i, j, s])
  }
}
const clusters = new Map()
items.forEach((_, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(i) })
let cands = [...clusters.values()].filter(c => c.length > 1 && c.length <= 12).map(c => c.map(i => items[i]))
const inCluster = new Set(cands.flat().map(r => r.id))
cands.push(...pairs.sort((a, b) => b[2] - a[2])
  .filter(([i, j]) => !inCluster.has(items[i].id) && !inCluster.has(items[j].id))
  .map(([i, j]) => [items[i], items[j]]))
plan.candidates = cands.length
cands = cands.slice(0, MAX)

// 3) Claude judges, 8 groups a call, through the Pbox bridge (subscription, not API)
// The judge: any module exporting makeMessageFull(system, messages, opts) -> { text, costUsd }.
// Without one, Morpheus still retires exact copies and reports the candidate groups unjudged.
let makeMessageFull = null
try { if (!ADAPTER) throw new Error('MORPHEUS_ADAPTER not set'); ({ makeMessageFull } = await import(ADAPTER)) } catch (e) { console.error('[morpheus] no judge adapter (' + e.message.slice(0, 80) + '): exact copies only'); cands = [] }
const SYS = `You tidy an assistant's long-term memory. For each numbered group of memories decide ONE verdict:
- "duplicate": they state the same thing; keep the clearest/most complete one, retire the others.
- "superseded": a later memory corrects or updates an earlier one about the same thing; keep the latest, retire the older.
- "distinct": different events, dates, people or facts (for example daily logs for different days); keep all.
- "conflict": they disagree and you cannot tell which is right; keep all.
Pay special attention to NUMBERS (visits, learners, money, dates, counts): two memories giving different figures for the same thing in the same period are "conflict" unless one clearly states it corrects/updates the other (then "superseded").
Be conservative: when unsure, choose "distinct". Never invent content.
A memory may only be retired if EVERY fact in it (names, figures, dates, decisions, reasons) is also in a kept memory. For each retired id, list in "lost" any fact it holds that no kept memory states; if anything would be lost, keep it.
Reply ONLY with JSON: {"groups":[{"n":1,"verdict":"...","keep":[ids],"retire":[ids],"lost":{"<id>":["fact only it has"]},"why":"short reason"}]}`
for (let b = 0; b < cands.length; b += 8) {
  const batch = cands.slice(b, b + 8)
  const body = batch.map((g, k) => `GROUP ${b + k + 1}\n` + g.map(r =>
    `  [id ${r.id} | ${new Date(r.created_at * 1000).toISOString().slice(0, 10)} | ${r.category}] ${r.content.slice(0, 600)}`).join('\n')).join('\n\n')
  let res
  try {
    res = await makeMessageFull(SYS, [{ role: 'user', content: body }], { priority: 2 })
  } catch (e) { console.error('[morpheus] judge call failed:', e.message); continue }
  plan.cost_usd += res.costUsd || 0
  let j
  try { j = JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1)) } catch { console.error('[morpheus] bad JSON from judge'); continue }
  for (const v of j.groups || []) {
    const g = batch[v.n - b - 1]
    if (!g) continue
    plan.judged++
    const ids = new Set(g.map(r => r.id))
    if (v.verdict === 'distinct') { plan.distinct++; continue }
    if (v.verdict === 'conflict') { plan.conflicts.push({ ids: [...ids], why: v.why }); continue }
    const keep = (v.keep || []).filter(i => ids.has(i))
    const ret = (v.retire || []).filter(i => ids.has(i) && !keep.includes(i))
    if (!keep.length || !ret.length) continue                 // never retire a whole group
    // _MORPHEUS_LOSSLESS_V1: never retire a memory that holds a fact the kept one lacks, and never
    // retire a NEWER memory in favour of an older one (a later save usually adds or corrects something)
    const lost = v.lost || {}
    const keepNewest = Math.max(...keep.map(i => byId.get(i).created_at))
    for (const id of ret) {
      const l = lost[id] || lost[String(id)] || []
      if (Array.isArray(l) && l.length) { plan.held = (plan.held || 0) + 1; continue }
      if (byId.get(id).created_at > keepNewest) { plan.held = (plan.held || 0) + 1; continue }   // any verdict: never retire the newer one
      plan.retire.push({ id, keep: keep[0], reason: v.verdict + ': ' + String(v.why || '').slice(0, 140), category: byId.get(id).category })
    }
  }
}

// email_context: report only
const now = Date.now() / 1000
plan.email_context_stale = rows.filter(r => r.category === 'email_context' && now - r.created_at > 90 * 86400 && !r.refs).length

// 4) apply: retire = invalid_at, logged for undo
if (MODE === 'apply') {
  ensureUndo(db)
  const st = db.prepare('UPDATE memories SET invalid_at=unixepoch() WHERE id=? AND invalid_at IS NULL')
  const lg = db.prepare('INSERT INTO morpheus_undo (run, memory_id, kept_id, reason, at) VALUES (?,?,?,?,unixepoch())')
  const ar = db.prepare(`INSERT OR IGNORE INTO memory_archive (memory_id, content, category, created_at, archived_at, reason, tags, kept_id, source)
    SELECT id, content, category, created_at, unixepoch(), ?, ?, ?, ? FROM memories WHERE id=?`)
  for (const x of plan.retire) {
    if (!st.run(x.id).changes) continue
    lg.run(RUN, x.id, x.keep, x.reason)
    const verdict = x.reason === 'exact copy' ? 'exact-copy' : x.reason.split(':')[0].trim()
    ar.run(`Morpheus: ${x.reason} (kept #${x.keep})`, `morpheus,${verdict},${x.category}`, x.keep, RUN, x.id)
  }
}
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/${RUN}.json`, JSON.stringify(plan, null, 1))
const nExact = plan.retire.filter(x => x.reason === 'exact copy').length
const md = [`# Morpheus ${MODE} ${RUN}`,
  `${plan.total} memories; ${plan.candidates} candidate groups, ${plan.judged} judged this run.`,
  `Retire ${plan.retire.length} (exact copies ${nExact}, judged ${plan.retire.length - nExact}); held back as not lossless ${plan.held || 0}; distinct ${plan.distinct}; conflicts for review ${plan.conflicts.length}; stale email_context (report only) ${plan.email_context_stale}.`,
  '', '## Conflicts (Zeus review)', ...plan.conflicts.map(c => `- ${FILES ? c.ids.map(i => byId.get(i).file).join(' vs ') : 'ids ' + c.ids.join(', ')}: ${c.why}`),
  '', '## Retire', ...plan.retire.map(x => FILES ? `- ${byId.get(x.id).file} -> keep ${byId.get(x.keep).file}: ${x.reason}` : `- ${x.id} -> keep ${x.keep} (${x.category}) ${x.reason}`)].join('\n')
writeFileSync(`${OUT}/${RUN}.md`, md)
console.log(md.split('\n').slice(0, 3).join('\n'))
console.log(`[morpheus] ${MODE} report: ${OUT}/${RUN}.md`)
