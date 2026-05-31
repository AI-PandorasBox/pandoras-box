// ${MODULE_HOME}/meta.mjs
// Meta Graph API client -- Facebook Pages + Instagram for the Pbox marketing module.
// Tokens JSON stored via module-cred-scope keychain pointer (meta_oauth_tokens).
// Token shape: { access_token, page_id, instagram_account_id? }
//   access_token: a Page Access Token (not a User token).

import https from 'node:https'
import { loadCred } from '../../module-cred-scope.mjs'

const GRAPH_VERSION = 'v19.0'

function _tokens (agentId) {
  const raw = loadCred(agentId, 'marketing', 'meta_oauth_tokens')
  let t
  try { t = JSON.parse(raw) } catch { throw new Error('meta_oauth_tokens: not valid JSON') }
  if (!t.access_token) throw new Error('meta_oauth_tokens: missing access_token')
  if (!t.page_id) throw new Error('meta_oauth_tokens: missing page_id')
  return t
}

function _req (method, path, qs, body) {
  return new Promise((resolve, reject) => {
    const qStr = qs && Object.keys(qs).length ? '?' + new URLSearchParams(qs).toString() : ''
    const bodyStr = body != null ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: '/' + GRAPH_VERSION + path + qStr,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { _raw: data } }
        if (parsed.error) {
          return reject(new Error('Meta error ' + parsed.error.code + ': ' + parsed.error.message))
        }
        if (res.statusCode >= 400) {
          return reject(new Error('Meta HTTP ' + res.statusCode + ': ' + data.slice(0, 200)))
        }
        resolve(parsed)
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ── Facebook ─────────────────────────────────────────────────────────────────

async function _fbPost (ctx, tokens, opts) {
  const log = ctx.log || (() => {})
  const payload = {
    message: opts.message,
    access_token: tokens.access_token,
    ...(opts.link ? { link: opts.link } : {}),
    ...(opts.published === false ? { published: false } : {}),
    ...(opts.scheduledPublishTime != null && opts.published === false
      ? { scheduled_publish_time: opts.scheduledPublishTime }
      : {}),
  }
  const res = await _req('POST', '/' + tokens.page_id + '/feed', null, payload)
  log('info', '[meta] facebook post created', { id: res.id, published: opts.published !== false })
  return {
    id: res.id,
    platform: 'facebook',
    status: opts.published === false ? 'scheduled' : 'published',
  }
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function _igPost (ctx, tokens, opts) {
  const log = ctx.log || (() => {})
  if (!tokens.instagram_account_id) throw new Error('meta_oauth_tokens: missing instagram_account_id')

  const containerPayload = {
    caption: opts.message,
    access_token: tokens.access_token,
    ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
    ...(opts.videoUrl ? { video_url: opts.videoUrl, media_type: 'REELS' } : {}),
  }
  if (!opts.imageUrl && !opts.videoUrl) throw new Error('metaCreatePost (instagram): imageUrl or videoUrl required')

  const container = await _req('POST', '/' + tokens.instagram_account_id + '/media', null, containerPayload)
  log('info', '[meta] instagram container created', { containerId: container.id })

  const publish = await _req('POST', '/' + tokens.instagram_account_id + '/media_publish', null, {
    creation_id: container.id,
    access_token: tokens.access_token,
  })
  log('info', '[meta] instagram post published', { id: publish.id })
  return { id: publish.id, platform: 'instagram', status: 'published' }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a Meta post on Facebook or Instagram.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ platform: 'facebook'|'instagram', message: string, link?: string, imageUrl?: string, videoUrl?: string }} opts
 *   For Instagram: imageUrl or videoUrl required; direct publish only (no scheduling via this path).
 * @returns {Promise<{ id: string, platform: string, status: string }>}
 */
export async function metaCreatePost (ctx, opts) {
  const tokens = _tokens(ctx.agentId)
  if (opts.platform === 'instagram') return _igPost(ctx, tokens, opts)
  return _fbPost(ctx, tokens, opts)
}

/**
 * Schedule a Meta post.
 * Facebook: uses the Graph API scheduled_publish_time mechanism.
 * Instagram: returns a conductor job handle (no native scheduling in Graph API).
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ platform?: 'facebook'|'instagram', message: string, link?: string, scheduledPublishTime: number }} opts
 *   scheduledPublishTime: Unix timestamp (seconds). Facebook: must be 10 min - 30 days ahead.
 * @returns {Promise<{ id?: string, platform: string, status: string, scheduled_at: string }>}
 */
export async function metaSchedulePost (ctx, opts) {
  const log = ctx.log || (() => {})
  const platform = opts.platform || 'facebook'
  log('info', '[meta] schedulePost', { platform, scheduledPublishTime: opts.scheduledPublishTime })

  if (platform === 'instagram') {
    return {
      status: 'scheduled',
      platform: 'instagram',
      scheduled_at: new Date(opts.scheduledPublishTime * 1000).toISOString(),
      job_payload: { type: 'instagram_publish', params: opts },
    }
  }

  const tokens = _tokens(ctx.agentId)
  return _fbPost(ctx, tokens, { ...opts, published: false })
}

/**
 * Get insights for a Facebook post.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ postId: string, metrics?: string[] }} opts
 * @returns {Promise<Object>}  keys are metric names, values are latest period values
 */
export async function metaGetPostInsights (ctx, opts) {
  const log = ctx.log || (() => {})
  const tokens = _tokens(ctx.agentId)
  const metrics = (opts.metrics || ['post_impressions', 'post_engaged_users', 'post_reactions_by_type_total']).join(',')
  log('info', '[meta] getPostInsights', { postId: opts.postId })

  const res = await _req('GET', '/' + opts.postId + '/insights', {
    metric: metrics,
    access_token: tokens.access_token,
  }, null)

  const out = {}
  for (const item of (res.data || [])) {
    const vals = item.values || []
    out[item.name] = vals.length > 0 ? vals[vals.length - 1].value : null
  }
  return out
}
