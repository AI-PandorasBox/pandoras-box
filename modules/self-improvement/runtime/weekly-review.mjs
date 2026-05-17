#!/usr/bin/env node
// weekly-review.mjs -- Pandoras Box self-improvement Sunday cycle (v0.3 stub)
//
// Real GEPA-style optimisation pipeline ships in v0.4. This v0.3 stub:
//   1. Walks INSTALL_PATH/*/logs and aggregates the last 7 days of activity
//   2. Counts errors, restarts, slow responses per module
//   3. Writes a markdown digest to INSTALL_PATH/self-improvement/weekly-YYYY-MM-DD.md
//   4. Touches a marker file so the dashboard knows when the last review ran
//
// Triggered by com.pandoras-box.self-improvement LaunchDaemon at Sunday 08:00.
// No HTTP surface, no auth needed.

import fs from 'node:fs'
import path from 'node:path'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const TARGET_DIR = path.join(INSTALL_PATH, 'self-improvement')
fs.mkdirSync(TARGET_DIR, { recursive: true })

const today = new Date().toISOString().slice(0, 10)
const since = Date.now() - 7 * 24 * 60 * 60 * 1000

function readLogPrefix() {
  try {
    const conf = fs.readFileSync(path.join(INSTALL_PATH, 'theme.conf'), 'utf8')
    const m = conf.match(/^LOG_PREFIX=["']?([^"'\n]+)["']?$/m)
    return m ? m[1] : 'pandoras-box'
  } catch { return 'pandoras-box' }
}
const LOG_PREFIX = readLogPrefix()

// Find /tmp/<prefix>-*.log files modified in the last 7 days
function recentLogs() {
  const out = []
  try {
    for (const f of fs.readdirSync('/tmp')) {
      if (!f.startsWith(`${LOG_PREFIX}-`) || !f.endsWith('.log')) continue
      const full = path.join('/tmp', f)
      try {
        const stat = fs.statSync(full)
        if (stat.mtimeMs >= since) {
          out.push({ file: full, size: stat.size, mtime: stat.mtime.toISOString() })
        }
      } catch {}
    }
  } catch {}
  return out
}

// Count error / restart / "FAIL" markers in a log
function summariseLog(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8')
    return {
      lines: txt.split('\n').length,
      errors: (txt.match(/^\s*(?:ERROR|FATAL|Error:|error:)/gm) || []).length,
      warnings: (txt.match(/^\s*(?:WARN|WARNING|Warning:)/gm) || []).length,
      restarts: (txt.match(/launchd:.*respawning/gi) || []).length,
    }
  } catch (e) { return { error: e.message } }
}

const logs = recentLogs()
const summary = logs.map(l => ({ file: l.file, mtime: l.mtime, size: l.size, ...summariseLog(l.file) }))

const md = []
md.push(`# Pandoras Box weekly review -- ${today}`)
md.push('')
md.push('_v0.3 stub. Full GEPA optimisation cycle ships in v0.4._')
md.push('')
md.push(`Window: last 7 days (since ${new Date(since).toISOString()}).`)
md.push('')
if (logs.length === 0) {
  md.push('No logs found.')
} else {
  md.push('## Log activity')
  md.push('')
  md.push('| Log | Size | Lines | Errors | Warnings | Restarts | Last write |')
  md.push('|---|---:|---:|---:|---:|---:|---|')
  for (const s of summary) {
    md.push(`| \`${path.basename(s.file)}\` | ${s.size} | ${s.lines || '-'} | ${s.errors || '-'} | ${s.warnings || '-'} | ${s.restarts || '-'} | ${s.mtime} |`)
  }
  md.push('')
  const totErr = summary.reduce((a, s) => a + (s.errors || 0), 0)
  const totRes = summary.reduce((a, s) => a + (s.restarts || 0), 0)
  md.push('## Headline')
  md.push('')
  md.push(`- ${logs.length} active log streams`)
  md.push(`- ${totErr} ERROR/FATAL lines`)
  md.push(`- ${totRes} launchd respawns`)
}

const outFile = path.join(TARGET_DIR, `weekly-${today}.md`)
fs.writeFileSync(outFile, md.join('\n'))
fs.writeFileSync(path.join(TARGET_DIR, 'last-run'), `${new Date().toISOString()}\n${outFile}\n`)
console.log(`[self-improvement] wrote ${outFile}`)
