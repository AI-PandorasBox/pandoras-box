#!/usr/bin/env node
// pbox-personal-ai.mjs -- Personal AI placeholder for v0.3
//
// The full Personal AI ships in v0.4. This v0.3 placeholder:
//   - Binds the configured port so the dashboard sees the service as RUNNING
//   - Serves a clear "v0.4 placeholder" page at GET /
//   - Returns 503 from any /api/* endpoint with an explanatory body
//
// Why ship the placeholder now: the install + dashboard + service-management
// surface needs to be exercisable end-to-end. The Personal AI runtime is
// genuinely a separate piece of work (voice + memory + MS365 + browser
// driver + skill loop) that doesn't compress into a single short module.
//
// Operators installing v0.3 get a working installer, dashboard, terminal,
// admin-lite, docs-server, content-classifier, self-improvement cron, plus
// this placeholder confirming the Personal AI slot is wired and ready for
// the v0.4 binary.

import http from 'node:http'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const PORT = parseInt(process.env.PERSONAL_AI_PORT || process.env.MUSE_PORT || '8800', 10)
const BIND = process.env.PERSONAL_AI_BIND || '127.0.0.1'
const DISPLAY_NAME = process.env.PERSONAL_AI_NAME || process.env.MUSE_DISPLAY_NAME || 'Assistant'

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${DISPLAY_NAME} -- v0.3 placeholder</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 60px auto; padding: 24px; color: #222; line-height: 1.6; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; }
  .meta { color: #888; font-size: 13px; margin-bottom: 32px; }
  .pending { background: #fffce0; padding: 20px 24px; border-left: 4px solid #d4a000; border-radius: 4px; }
  code { background: #f4f4f6; padding: 1px 6px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
</style></head><body>
<h1>${DISPLAY_NAME}</h1>
<div class="meta">Pandoras Box -- Personal AI placeholder server (v0.3)</div>
<div class="pending">
  <strong>This is the v0.3 release.</strong>
  <p>The full Personal AI -- voice, memory, mail/calendar/files, browser
  automation, skill loop, watch companion -- ships in <strong>v0.4</strong>.
  This placeholder confirms the service slot is wired correctly and the
  installer can register the LaunchDaemon. Updating to v0.4 will drop the
  full runtime into this same slot.</p>
  <p>What works today in v0.3:</p>
  <ul>
    <li>The installer, all module configuration, plist registration, sanitize hooks</li>
    <li>Dashboard at <code>http://127.0.0.1:8181</code> -- watch the service status</li>
    <li>Admin Lite at <code>http://127.0.0.1:8488</code> -- mobile-friendly restart</li>
    <li>Browser terminal at <code>http://127.0.0.1:8484</code> -- log tail + restart</li>
    <li>Local docs at <code>http://127.0.0.1:8485</code> -- manuals + architecture</li>
    <li>Content classifier sidecar (shadow mode) at <code>http://127.0.0.1:8487</code></li>
    <li>Weekly self-improvement review on Sundays at 08:00</li>
  </ul>
</div>
</body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, version: 'v0.3-placeholder', note: 'Personal AI runtime ships in v0.4' }))
    return
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Personal AI runtime not yet shipped', version: 'v0.3-placeholder' }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})

server.listen(PORT, BIND, () => {
  console.log(`[personal-ai] v0.3 placeholder listening on http://${BIND}:${PORT}`)
  console.log(`[personal-ai] display name: ${DISPLAY_NAME}`)
  console.log(`[personal-ai] (full Personal AI runtime ships in v0.4)`)
})
