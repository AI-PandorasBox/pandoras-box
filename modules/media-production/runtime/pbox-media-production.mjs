#!/usr/bin/env node
// pbox-media-production.mjs -- background queue worker for media generation
// Polls a queue dir for job files, dispatches to one of four backends
// (Suno, ElevenLabs, Imagen, Veo), writes outputs to a per-job dir.
// Optional localhost HTTP submission surface (operator-machine only).
// Security: no shell; fetch builtin for all HTTP; allowlisted job kinds.

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const INSTALL_PATH = process.env.INSTALL_PATH || '/opt/pandoras-box'
const MODULE_ROOT = path.join(INSTALL_PATH, 'media-production')
const QUEUE_DIR = process.env.MEDIA_PRODUCTION_QUEUE_DIR || path.join(MODULE_ROOT, 'store', 'queue')
const OUTPUT_DIR = process.env.MEDIA_PRODUCTION_OUTPUT_DIR || path.join(MODULE_ROOT, 'output')
const POLL_MS = parseInt(process.env.MEDIA_PRODUCTION_POLL_MS || '30000', 10)
const HTTP_ENABLED = process.env.MEDIA_PRODUCTION_HTTP === '1'
const HTTP_PORT = parseInt(process.env.MEDIA_PRODUCTION_PORT || '8486', 10)
const HTTP_BIND = process.env.MEDIA_PRODUCTION_BIND || '127.0.0.1'

const ALLOWED_KINDS = new Set(['music', 'narration', 'image', 'video'])
const TERMINAL_STATUS = new Set(['complete', 'failed'])

// Per-kind hard timeouts (ms). Veo polled separately with its own ceiling.
const FETCH_TIMEOUT_MS = 60_000
const VEO_POLL_INTERVAL_MS = 15_000
const VEO_POLL_CEILING_MS = 30 * 60_000

const log = (lvl, msg, extra) => {
  const line = { t: new Date().toISOString(), lvl, msg, ...(extra || {}) }
  process.stdout.write(JSON.stringify(line) + '\n')
}

// -- queue file helpers -------------------------------------------------------

async function ensureDirs() {
  await fsp.mkdir(QUEUE_DIR, { recursive: true, mode: 0o750 })
  await fsp.mkdir(OUTPUT_DIR, { recursive: true, mode: 0o750 })
}

function jobFilePath(jobId) {
  // Job IDs are validated before they reach disk; path traversal is gated.
  return path.join(QUEUE_DIR, `${jobId}.json`)
}

function isValidJobId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(id)
}

async function readJob(jobId) {
  const raw = await fsp.readFile(jobFilePath(jobId), 'utf8')
  return JSON.parse(raw)
}

async function writeJob(job) {
  const tmp = jobFilePath(job.job_id) + '.tmp'
  const final = jobFilePath(job.job_id)
  job.updated_at = new Date().toISOString()
  await fsp.writeFile(tmp, JSON.stringify(job, null, 2), { mode: 0o640 })
  await fsp.rename(tmp, final)
}

async function listJobs() {
  let entries = []
  try { entries = await fsp.readdir(QUEUE_DIR) } catch { return [] }
  const jobs = []
  for (const e of entries) {
    if (!e.endsWith('.json')) continue
    const id = e.slice(0, -5)
    if (!isValidJobId(id)) continue
    try { jobs.push(await readJob(id)) } catch {}
  }
  return jobs
}

// -- output dir for a job -----------------------------------------------------

async function jobOutputDir(jobId) {
  const dir = path.join(OUTPUT_DIR, jobId)
  await fsp.mkdir(dir, { recursive: true, mode: 0o750 })
  return dir
}

// -- HTTP helpers -------------------------------------------------------------

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function readResponseBuffer(res) {
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

// -- backend: Suno (music) ----------------------------------------------------
// STATUS: experimental. Suno does not publish a stable public API at the time
// of writing; the endpoint shape below is best-effort and may need to be
// re-pointed to whichever provider exposes a stable surface. See README.

async function runMusicJob(job) {
  const key = process.env.SUNO_API_KEY
  if (!key) throw new Error('SUNO_API_KEY not configured')
  const prompt = (job.params && job.params.prompt) || ''
  if (!prompt) throw new Error('params.prompt required')

  const res = await fetchWithTimeout('https://studio-api.suno.ai/api/generate/v2/', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      make_instrumental: job.params.instrumental ?? false,
      mv: job.params.model || 'chirp-v3-5',
    }),
  })
  if (!res.ok) throw new Error(`suno http ${res.status}`)
  const body = await res.json()
  // The Suno API (when reachable) returns clip metadata with audio_url(s);
  // we save the first available URL's audio to disk.
  const clip = Array.isArray(body) ? body[0] : (body.clips && body.clips[0]) || body
  const audioUrl = clip?.audio_url
  if (!audioUrl) throw new Error('suno response missing audio_url')

  const audio = await fetchWithTimeout(audioUrl, {}, FETCH_TIMEOUT_MS * 4)
  if (!audio.ok) throw new Error(`suno audio fetch http ${audio.status}`)
  const buf = await readResponseBuffer(audio)
  const dir = await jobOutputDir(job.job_id)
  const out = path.join(dir, 'music.mp3')
  await fsp.writeFile(out, buf, { mode: 0o640 })
  return out
}

// -- backend: ElevenLabs (narration) ------------------------------------------

async function runNarrationJob(job) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured')
  const text = job.params && job.params.text
  if (!text) throw new Error('params.text required')

  const voiceId = (job.params && job.params.voice_id) || process.env.MEDIA_NARRATION_VOICE_ID
  if (!voiceId) throw new Error('voice_id required (params.voice_id or MEDIA_NARRATION_VOICE_ID)')

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'content-type': 'application/json',
      'accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: job.params.model_id || 'eleven_multilingual_v2',
      voice_settings: job.params.voice_settings || { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
  if (!res.ok) throw new Error(`elevenlabs http ${res.status}`)
  const buf = await readResponseBuffer(res)
  const dir = await jobOutputDir(job.job_id)
  const out = path.join(dir, 'narration.mp3')
  await fsp.writeFile(out, buf, { mode: 0o640 })
  return out
}

// -- backend: Imagen (image) --------------------------------------------------

async function runImageJob(job) {
  const key = process.env.GOOGLE_AI_KEY
  if (!key) throw new Error('GOOGLE_AI_KEY not configured')
  const prompt = job.params && job.params.prompt
  if (!prompt) throw new Error('params.prompt required')

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages'
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt: { text: prompt },
      sampleCount: Math.min(Math.max(job.params.count || 1, 1), 4),
      aspectRatio: job.params.aspect_ratio || '1:1',
    }),
  })
  if (!res.ok) throw new Error(`imagen http ${res.status}`)
  const body = await res.json()
  const preds = body.predictions || body.images || []
  if (!preds.length) throw new Error('imagen response missing predictions')

  const dir = await jobOutputDir(job.job_id)
  const outs = []
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i]
    // API may return bytesBase64Encoded (preferred) or a URL field. Handle both.
    let buf
    if (p.bytesBase64Encoded || p.image?.bytesBase64Encoded) {
      buf = Buffer.from(p.bytesBase64Encoded || p.image.bytesBase64Encoded, 'base64')
    } else if (p.url) {
      const r = await fetchWithTimeout(p.url)
      if (!r.ok) throw new Error(`imagen url fetch http ${r.status}`)
      buf = await readResponseBuffer(r)
    } else {
      throw new Error(`imagen prediction ${i} missing bytes/url`)
    }
    const out = path.join(dir, `image-${i + 1}.png`)
    await fsp.writeFile(out, buf, { mode: 0o640 })
    outs.push(out)
  }
  return outs.length === 1 ? outs[0] : outs
}

// -- backend: Veo (video) -- long-running poll -------------------------------

async function runVideoJob(job) {
  const key = process.env.GOOGLE_AI_KEY
  if (!key) throw new Error('GOOGLE_AI_KEY not configured')
  const prompt = job.params && job.params.prompt
  if (!prompt) throw new Error('params.prompt required')

  const startUrl = 'https://generativelanguage.googleapis.com/v1beta/models/veo-001:generateVideos'
  const start = await fetchWithTimeout(startUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt: { text: prompt },
      aspectRatio: job.params.aspect_ratio || '16:9',
      durationSeconds: job.params.duration_seconds || 8,
    }),
  })
  if (!start.ok) throw new Error(`veo start http ${start.status}`)
  const startBody = await start.json()
  const opName = startBody.name || startBody.operationName
  if (!opName) throw new Error('veo response missing operation name')

  // Persist op name so the user can see it during the poll.
  job.operation = opName
  await writeJob(job)

  const deadline = Date.now() + VEO_POLL_CEILING_MS
  let finalUrl = null
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, VEO_POLL_INTERVAL_MS))
    const opUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}`
    const op = await fetchWithTimeout(opUrl, { headers: { 'x-goog-api-key': key } })
    if (!op.ok) throw new Error(`veo poll http ${op.status}`)
    const body = await op.json()
    if (body.done) {
      if (body.error) throw new Error(`veo op error: ${body.error.message || JSON.stringify(body.error)}`)
      // Response shape varies; look for first video URI or inline bytes.
      const resp = body.response || {}
      const videos = resp.generatedVideos || resp.videos || resp.predictions || []
      const v = videos[0] || {}
      finalUrl = v.video?.uri || v.uri || v.videoUrl || null
      if (!finalUrl && v.bytesBase64Encoded) {
        const buf = Buffer.from(v.bytesBase64Encoded, 'base64')
        const dir = await jobOutputDir(job.job_id)
        const out = path.join(dir, 'video.mp4')
        await fsp.writeFile(out, buf, { mode: 0o640 })
        return out
      }
      if (!finalUrl) throw new Error('veo op done but no video uri/bytes')
      break
    }
  }
  if (!finalUrl) throw new Error('veo poll timeout')

  const vr = await fetchWithTimeout(finalUrl, { headers: { 'x-goog-api-key': key } }, FETCH_TIMEOUT_MS * 4)
  if (!vr.ok) throw new Error(`veo download http ${vr.status}`)
  const buf = await readResponseBuffer(vr)
  const dir = await jobOutputDir(job.job_id)
  const out = path.join(dir, 'video.mp4')
  await fsp.writeFile(out, buf, { mode: 0o640 })
  return out
}

// -- dispatch -----------------------------------------------------------------

const DISPATCH = {
  music: runMusicJob,
  narration: runNarrationJob,
  image: runImageJob,
  video: runVideoJob,
}

async function processJob(job) {
  if (!ALLOWED_KINDS.has(job.kind)) {
    job.status = 'failed'
    job.error = `unknown kind: ${job.kind}`
    await writeJob(job)
    log('error', 'rejected unknown kind', { job_id: job.job_id, kind: job.kind })
    return
  }
  job.status = 'running'
  job.error = null
  await writeJob(job)
  log('info', 'job start', { job_id: job.job_id, kind: job.kind })
  try {
    const out = await DISPATCH[job.kind](job)
    job.status = 'complete'
    job.output_path = out
    await writeJob(job)
    log('info', 'job complete', { job_id: job.job_id, output_path: out })
  } catch (e) {
    job.status = 'failed'
    job.error = String(e?.message || e)
    await writeJob(job)
    log('error', 'job failed', { job_id: job.job_id, err: job.error })
  }
}

// In-memory guard so a long-running job is not picked up again on the next tick.
const inflight = new Set()

async function tick() {
  let jobs
  try { jobs = await listJobs() } catch (e) { log('error', 'listJobs failed', { err: e.message }); return }
  for (const job of jobs) {
    if (!job || !job.job_id || !isValidJobId(job.job_id)) continue
    if (TERMINAL_STATUS.has(job.status)) continue
    if (inflight.has(job.job_id)) continue
    if (job.status !== 'pending' && job.status !== 'running') continue
    // If a previous worker process died mid-run, status will be 'running' on disk;
    // we re-pick those up on restart. inflight gate prevents intra-process double-run.
    inflight.add(job.job_id)
    processJob(job).finally(() => inflight.delete(job.job_id))
  }
}

// -- HTTP surface (optional) --------------------------------------------------

function newJobId() {
  return crypto.randomBytes(8).toString('hex')
}

function jsonResponse(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let bytes = 0
    const chunks = []
    req.on('data', c => {
      bytes += c.length
      if (bytes > max) { req.destroy(); reject(new Error('body too large')); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

async function handleSubmit(req, res) {
  let body
  try { body = await readJsonBody(req) }
  catch (e) { jsonResponse(res, 400, { error: `bad json: ${e.message}` }); return }
  if (!body || typeof body !== 'object') { jsonResponse(res, 400, { error: 'object required' }); return }
  const kind = body.kind
  if (!ALLOWED_KINDS.has(kind)) {
    jsonResponse(res, 400, { error: `kind must be one of: ${[...ALLOWED_KINDS].join(', ')}` })
    return
  }
  const params = (body.params && typeof body.params === 'object') ? body.params : {}
  const jobId = newJobId()
  const now = new Date().toISOString()
  const job = {
    job_id: jobId,
    kind,
    params,
    status: 'pending',
    created_at: now,
    updated_at: now,
  }
  await writeJob(job)
  log('info', 'job submitted', { job_id: jobId, kind })
  jsonResponse(res, 201, { job_id: jobId, status: 'pending' })
}

async function handleGet(req, res, jobId) {
  if (!isValidJobId(jobId)) { jsonResponse(res, 400, { error: 'invalid job_id' }); return }
  try {
    const job = await readJob(jobId)
    jsonResponse(res, 200, job)
  } catch (e) {
    if (e.code === 'ENOENT') { jsonResponse(res, 404, { error: 'not found' }); return }
    jsonResponse(res, 500, { error: e.message })
  }
}

async function handleList(req, res) {
  const jobs = await listJobs()
  // Sort newest-first for caller convenience.
  jobs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  jsonResponse(res, 200, { jobs })
}

function startHttp() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`)
      if (req.method === 'POST' && url.pathname === '/api/jobs') return handleSubmit(req, res)
      if (req.method === 'GET'  && url.pathname === '/api/jobs') return handleList(req, res)
      const m = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)
      if (req.method === 'GET' && m) return handleGet(req, res, m[1])
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return jsonResponse(res, 200, { ok: true, time: new Date().toISOString() })
      }
      jsonResponse(res, 404, { error: 'not found' })
    } catch (e) {
      log('error', 'http handler failed', { err: e.message })
      try { jsonResponse(res, 500, { error: 'internal' }) } catch {}
    }
  })
  server.listen(HTTP_PORT, HTTP_BIND, () => {
    log('info', 'http listening', { bind: HTTP_BIND, port: HTTP_PORT })
  })
  return server
}

// -- main loop ----------------------------------------------------------------

async function main() {
  await ensureDirs()
  log('info', 'media-production started', {
    install_path: INSTALL_PATH,
    queue_dir: QUEUE_DIR,
    output_dir: OUTPUT_DIR,
    poll_ms: POLL_MS,
    http: HTTP_ENABLED ? `${HTTP_BIND}:${HTTP_PORT}` : 'disabled',
  })
  if (HTTP_ENABLED) startHttp()

  // Run the first tick immediately, then on interval.
  tick().catch(e => log('error', 'tick failed', { err: e.message }))
  setInterval(() => {
    tick().catch(e => log('error', 'tick failed', { err: e.message }))
  }, POLL_MS)
}

main().catch(e => {
  log('error', 'fatal', { err: e.message, stack: e.stack })
  process.exit(1)
})
