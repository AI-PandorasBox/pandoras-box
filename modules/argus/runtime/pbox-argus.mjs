#!/usr/bin/env node
// pbox-argus.mjs -- the Security Overseer daemon.
// Reviews PENDING_REVIEW jobs across every tenant's jobs.db by scoring the
// prompt through the content-classifier, then flips the row APPROVED or
// REJECTED. Tracks per-source strikes (N-strike quarantine) and runs a weekly
// dependency scan. This is the real "Tier 1" oversight the docs describe.
// _ARGUS_V1
//
// Fail-closed by default: if the classifier is unreachable, jobs stay
// PENDING_REVIEW (nothing is approved unseen). Set ARGUS_FAIL_OPEN=true to
// auto-approve when the classifier is down (not recommended).
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const POLL_SEC = parseInt(process.env.ARGUS_POLL_SEC || '60', 10)
const CLASSIFIER_URL = (process.env.CONTENT_CLASSIFIER_URL || 'http://127.0.0.1:8487').replace(/\/$/, '')
const STRIKE_LIMIT = parseInt(process.env.ARGUS_STRIKE_LIMIT || '3', 10)
const FAIL_OPEN = (process.env.ARGUS_FAIL_OPEN || 'false').toLowerCase() === 'true'
const STORE_DIR = process.env.ARGUS_STORE || path.join(INSTALL_PATH, 'argus', 'store')
const DEP_SCAN_EVERY_MS = 7 * 24 * 3600 * 1000

fs.mkdirSync(STORE_DIR, { recursive: true })
const adb = new DatabaseSync(path.join(STORE_DIR, 'argus.db'))
adb.prepare('CREATE TABLE IF NOT EXISTS strikes (source TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, last_ts INTEGER)').run()
adb.prepare('CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT)').run()
const getState = (k) => { const r = adb.prepare('SELECT v FROM state WHERE k=?').get(k); return r ? r.v : null }
const setState = (k, v) => adb.prepare('INSERT INTO state (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v))
const getStrikes = (s) => { const r = adb.prepare('SELECT count FROM strikes WHERE source=?').get(s); return r ? r.count : 0 }
const addStrike = (s) => adb.prepare('INSERT INTO strikes (source,count,last_ts) VALUES (?,1,?) ON CONFLICT(source) DO UPDATE SET count=count+1, last_ts=excluded.last_ts').run(s, Date.now())

const AUDIT = path.join(STORE_DIR, 'argus-audit.log')
function audit (event) {
  try { fs.appendFileSync(AUDIT, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n') } catch {}
}
const logLine = (m, x) => console.log(`[argus] ${m}${x ? ' ' + JSON.stringify(x) : ''}`)

async function score (text) {
  // returns 'allow' | 'block' | null(unreachable)
  try {
    const r = await fetch(`${CLASSIFIER_URL}/api/score`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 4096) }),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return null
    const j = await r.json()
    return (j.verdict === 'block' || j.verdict === 'reject') ? 'block' : 'allow'
  } catch { return null }
}

function discoverJobDbs () {
  const out = []
  try {
    for (const e of fs.readdirSync(INSTALL_PATH, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(INSTALL_PATH, e.name, 'store', 'jobs.db')
      if (fs.existsSync(p)) out.push({ slug: e.name, path: p })
    }
  } catch {}
  return out
}

function flip (db, id, status, note, detail) {
  db.prepare('UPDATE jobs SET status=?, updated_at=?, reviewer_note=? WHERE id=?').run(status, Date.now(), note, id)
  db.prepare('INSERT INTO job_events (id, job_id, event_type, actor, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(crypto.randomUUID(), id, 'reviewed', 'argus', JSON.stringify(detail || {}), Date.now())
}

async function reviewTenant (slug, dbPath) {
  let db
  try { db = new DatabaseSync(dbPath) } catch (e) { logLine('cannot open jobs.db', { slug, error: e.message }); return }
  let pending
  try { pending = db.prepare("SELECT id, prompt, conductor_ref FROM jobs WHERE status='PENDING_REVIEW' ORDER BY created_at ASC LIMIT 50").all() }
  catch (e) { db.close(); return }
  for (const job of pending) {
    const source = `${slug}:${job.conductor_ref || 'unknown'}`
    // N-strike quarantine: a source over the limit is blocked outright.
    if (getStrikes(source) >= STRIKE_LIMIT) {
      flip(db, job.id, 'BLOCKED', `argus: source quarantined (>=${STRIKE_LIMIT} strikes)`, { decision: 'blocked', reason: 'quarantine', source })
      audit({ kind: 'quarantine_block', slug, job: job.id, source })
      continue
    }
    const verdict = await score(job.prompt)
    if (verdict === null) {
      if (FAIL_OPEN) {
        flip(db, job.id, 'APPROVED', 'argus: classifier down, fail-open', { decision: 'approved', reason: 'fail-open' })
        audit({ kind: 'fail_open_approve', slug, job: job.id })
      } else {
        audit({ kind: 'classifier_unreachable_hold', slug, job: job.id })   // leave PENDING_REVIEW
      }
      continue
    }
    if (verdict === 'block') {
      addStrike(source)
      flip(db, job.id, 'REJECTED', 'argus: blocked by content-classifier', { decision: 'rejected', reason: 'classifier_block', source, strikes: getStrikes(source) })
      audit({ kind: 'block', slug, job: job.id, source, strikes: getStrikes(source) })
    } else {
      flip(db, job.id, 'APPROVED', 'argus: reviewed, allowed', { decision: 'approved' })
      audit({ kind: 'approve', slug, job: job.id })
    }
  }
  db.close()
}

function weeklyDepScan () {
  const last = parseInt(getState('last_dep_scan') || '0', 10)
  if (Date.now() - last < DEP_SCAN_EVERY_MS) return
  setState('last_dep_scan', Date.now())
  const target = fs.existsSync(path.join(INSTALL_PATH, 'package.json')) ? INSTALL_PATH : null
  const out = path.join(STORE_DIR, 'pending-mitigations.json')
  if (!target) {
    fs.writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), skipped: 'no package.json at INSTALL_PATH', findings: [] }, null, 2))
    audit({ kind: 'dep_scan_skipped' })
    return
  }
  execFile('npm', ['audit', '--json'], { cwd: target, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
    let findings = {}
    try { findings = JSON.parse(stdout || '{}') } catch {}
    const vulns = (findings.metadata && findings.metadata.vulnerabilities) || {}
    fs.writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), vulnerabilities: vulns, advisories: Object.keys(findings.vulnerabilities || {}) }, null, 2))
    audit({ kind: 'dep_scan', vulnerabilities: vulns })
    logLine('weekly dependency scan complete', vulns)
  })
}

async function tick () {
  for (const t of discoverJobDbs()) {
    try { await reviewTenant(t.slug, t.path) } catch (e) { logLine('review error', { slug: t.slug, error: e.message }) }
  }
  try { weeklyDepScan() } catch (e) { logLine('dep scan error', { error: e.message }) }
}

logLine('starting', { install: INSTALL_PATH, classifier: CLASSIFIER_URL, poll_sec: POLL_SEC, strike_limit: STRIKE_LIMIT, fail_open: FAIL_OPEN })
audit({ kind: 'argus_started' })
tick()
setInterval(tick, POLL_SEC * 1000)

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { audit({ kind: 'argus_stopped' }); try { adb.close() } catch {}; process.exit(0) })
