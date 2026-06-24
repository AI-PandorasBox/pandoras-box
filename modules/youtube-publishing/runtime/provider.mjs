// ${MODULE_HOME}/provider.mjs
//
// Shared YouTube-publishing provider: upload a video file to YouTube and manage
// its OAuth tokens. Caller passes a context object with storeDir + log + env so
// this module is not coupled to any one producer's globals. Any agent that
// activates the youtube-publishing manifest can import from here.
//
// Credentials are read from the env vars YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import https from 'node:https'

export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
]

/**
 * Load YouTube tokens from disk.
 * @param {{ storeDir: string }} ctx
 */
export function loadYouTubeTokens (ctx) {
  const tokenPath = join(ctx.storeDir, 'youtube-tokens.json')
  if (!existsSync(tokenPath)) throw new Error('YouTube tokens not found at ' + tokenPath + '. Run the YouTube OAuth setup first.')
  return JSON.parse(readFileSync(tokenPath, 'utf8'))
}

/**
 * Persist YouTube tokens, chmod 640.
 * @param {{ storeDir: string }} ctx
 * @param {object} tokens
 */
export function saveYouTubeTokens (ctx, tokens) {
  const tokenPath = join(ctx.storeDir, 'youtube-tokens.json')
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2))
  execFileSync('chmod', ['640', tokenPath])
}

/**
 * Call Google OAuth refresh endpoint.
 * @param {{ env?: object }} ctx
 * @param {object} tokens
 */
export async function refreshAccessToken (ctx, tokens) {
  const env = (ctx && ctx.env) || process.env
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type:    'refresh_token',
    }).toString()
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        const parsed = JSON.parse(data)
        if (parsed.error) return reject(new Error('Token refresh failed: ' + parsed.error_description))
        resolve(parsed)
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * Get a valid access token, refreshing if needed. Persists rotated refresh_token if Google issues one.
 * @param {{ storeDir: string, log?: function, env?: object }} ctx
 */
export async function getValidAccessToken (ctx) {
  const log = ctx.log || (() => {})
  let tokens = loadYouTubeTokens(ctx)
  const expiresAt = tokens.expires_at || 0
  if (Date.now() >= expiresAt - 60_000) {
    log('info', 'Refreshing YouTube access token...')
    const refreshed = await refreshAccessToken(ctx, tokens)
    if (refreshed.refresh_token) tokens.refresh_token = refreshed.refresh_token // rotate refresh token if Google issues a new one
    tokens.access_token = refreshed.access_token
    tokens.expires_at   = Date.now() + (refreshed.expires_in * 1000)
    saveYouTubeTokens(ctx, tokens)
    log('info', 'YouTube token refreshed')
  }
  return tokens.access_token
}

/**
 * Build YouTube video metadata payload (snippet + status).
 * Example format below: long-form ambient music with 30-min chapter markers.
 * Producers may want a different metadata builder -- they pass their own and skip this one.
 *
 * @param {string} themeId
 * @param {object} promptsData  themeId -> { name, ... }
 * @param {{ channel?: string }} [opts]
 */
export function buildVideoMetadata (themeId, promptsData, opts = {}) {
  const themeData = promptsData[themeId]
  const themeName = themeData.name

  const chapters = []
  for (let m = 0; m < 480; m += 30) {
    const h = Math.floor(m / 60)
    const min = m % 60
    chapters.push(String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':00 ' + themeName)
  }

  const description = [
    themeName + ' — 8 hours of continuous background music. Not registered with PPL or PRS.',
    'Free to play in your business, office, shop, or home.',
    '',
    '── CHAPTERS ──',
    ...chapters,
    '',
    '── ABOUT ──',
    'Free Background Focus provides AI-generated ambient music for focus, relaxation, and business use.',
    'All tracks are generated using AI and are not registered with PPL or PRS.',
    'No licence is required to play this music in your business in the UK.',
    '',
    '── FIND US ──',
    'Website: https://examplesite.co.uk',
    'YouTube: https://youtube.com/@examplesite',
  ].join('\n')

  const tags = [
    'background music', 'no PPL', 'no PRS', 'royalty free',
    '8 hours', 'ambient', 'business music', 'focus music',
    themeName.toLowerCase(), 'free business music', 'UK business music',
    'no music licence', 'AI music', 'instrumental',
  ]

  return {
    snippet: {
      title:       themeName + ' | 8 Hours Background Music | No PPL · No PRS',
      description,
      tags,
      categoryId:  '10',
    },
    status: {
      privacyStatus:           'public',
      selfDeclaredMadeForKids: false,
    },
  }
}

/**
 * Resumable upload of a video file to YouTube.
 * @param {{ log?: function }} ctx
 * @param {string} videoPath
 * @param {object} metadata   shape from buildVideoMetadata or compatible
 * @param {string} accessToken
 */
export async function uploadYouTube (ctx, videoPath, metadata, accessToken) {
  const log = (ctx && ctx.log) || (() => {})
  const fileSize = statSync(videoPath).size
  log('info', 'Starting YouTube resumable upload', { fileSizeMB: Math.round(fileSize / 1024 / 1024) })

  // 1. Initiate resumable upload
  const initBody = JSON.stringify(metadata)
  const uploadUrl = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path:     '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      method:   'POST',
      headers:  {
        'Authorization':  'Bearer ' + accessToken,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(initBody),
        'X-Upload-Content-Type':   'video/mp4',
        'X-Upload-Content-Length': fileSize,
      },
    }, res => {
      if (res.statusCode !== 200) {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => reject(new Error('Upload init failed ' + res.statusCode + ': ' + body.slice(0, 200))))
        return
      }
      const location = res.headers['location']
      if (!location) return reject(new Error('No upload URL in response'))
      resolve(location)
    })
    req.on('error', reject)
    req.write(initBody)
    req.end()
  })

  log('info', 'Upload session initiated, sending video file...')

  // 2. Upload file
  const videoData = readFileSync(videoPath)
  const uploadUrlObj = new URL(uploadUrl)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrlObj.hostname,
      path:     uploadUrlObj.pathname + uploadUrlObj.search,
      method:   'PUT',
      headers:  {
        'Content-Type':   'video/mp4',
        'Content-Length': fileSize,
      },
    }, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(body))
        } else {
          reject(new Error('Upload failed ' + res.statusCode + ': ' + body.slice(0, 300)))
        }
      })
    })
    req.on('error', reject)
    req.write(videoData)
    req.end()
  })
}
