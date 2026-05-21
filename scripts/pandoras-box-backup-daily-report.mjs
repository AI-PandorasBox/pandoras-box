#!/usr/bin/env node
// pandoras-box-backup-daily-report.mjs
// Marker: _PBOX_BACKUP_REPORT_V1
//
// Two roles:
//   1) Invoked by pandoras-box-backup.sh at the end of each run with a payload
//      JSON file path argument -- sends [OK]/[FAIL] email immediately.
//   2) Triggered by com.pandoras-box.backup-daily-report LaunchAgent at 07:00
//      with no args -- reads the most recent component status from the daemon
//      log and sends a "did the backup run last night?" digest.
//
// Skips silently if SMTP creds are not configured in /usr/local/etc/pandoras-box-backup.env.

import { readFileSync, existsSync, statSync } from 'node:fs'
import nodemailer from 'nodemailer' // requires `npm i -g nodemailer` (or local lib path)

const ENV_FILE = '/usr/local/etc/pandoras-box-backup.env'

function loadEnv () {
  if (!existsSync(ENV_FILE)) return {}
  const out = {}
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

const env = loadEnv()
const SMTP_HOST  = env.SMTP_HOST  || ''
const SMTP_USER  = env.SMTP_USER  || ''
const SMTP_PASS  = env.SMTP_PASS  || ''
const REPORT_TO  = env.REPORT_EMAIL_TO || ''

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_TO) {
  console.log('SMTP not configured in', ENV_FILE, '-- nothing to send. Exiting 0.')
  process.exit(0)
}

const payloadPath = process.argv[2]
let payload
if (payloadPath && existsSync(payloadPath)) {
  payload = JSON.parse(readFileSync(payloadPath, 'utf8'))
} else {
  // Digest mode -- inspect last run.
  const blob = '/Users/Shared/pandoras-box-backups/latest'
  if (!existsSync(blob)) {
    payload = { label: 'pandoras-box-backup', verdict: 'unknown', fatal_reason: 'latest symlink missing', components: [] }
  } else {
    const real = statSync(blob)
    const age  = (Date.now() - real.mtimeMs) / 86_400_000
    payload = {
      label: 'pandoras-box-backup',
      verdict: age > 1.5 ? 'fail' : 'ok',
      fatal_reason: age > 1.5 ? `latest blob is ${age.toFixed(1)} days old` : '',
      encrypted_size_bytes: real.size,
      components: [],
    }
  }
}

const verdict = (payload.verdict || 'unknown').toUpperCase()
const subject = `[${verdict}] Pandoras Box backup -- ${payload.stamp || new Date().toISOString().slice(0,10)}`

const lines = []
lines.push(`Pandoras Box ${payload.label || 'backup'} report`)
lines.push(`Date:    ${payload.stamp || new Date().toISOString().slice(0,10)}`)
lines.push(`Verdict: ${verdict}`)
if (payload.encrypted_blob)       lines.push(`Blob:    ${payload.encrypted_blob}`)
if (payload.encrypted_size_bytes) lines.push(`Size:    ${(payload.encrypted_size_bytes/1024/1024).toFixed(1)} MB`)
if (payload.fatal_reason)         lines.push(`Fatal:   ${payload.fatal_reason}`)
lines.push('')
lines.push('Components:')
for (const c of payload.components || []) {
  lines.push(`  ${(c.status || '').padEnd(12)} ${(c.name || '').padEnd(28)} ${String(c.bytes || 0).padStart(12)} bytes  ${c.path || ''}`)
}

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
})

try {
  await transport.sendMail({
    from:    SMTP_USER,
    to:      REPORT_TO,
    subject,
    text:    lines.join('\n'),
  })
  console.log('email sent ->', REPORT_TO)
  process.exit(0)
} catch (e) {
  console.error('email send failed:', e.message)
  process.exit(1)
}
