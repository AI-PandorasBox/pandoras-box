// ${MODULE_HOME}/linkedin.mjs
// LinkedIn UGC Posts API client for the Pbox marketing module.
// Tokens JSON stored via module-cred-scope keychain pointer (linkedin_oauth_tokens).
// Token shape: { access_token, refresh_token?, expires_at, author_urn }
//   author_urn: "urn:li:person:{id}" for personal or "urn:li:organization:{id}" for page.

import https from 'node:https'
import { loadCred } from '../../module-cred-scope.mjs'

function _tokens (agentId) {
  const raw = loadCred(agentId, 'marketing', 'linkedin_oauth_tokens')
  let t
  try { t = JSON.parse(raw) } catch { throw new Error('linkedin_oauth_tokens: not valid JSON') }
  if (!t.access_token) throw new Error('linkedin_oauth_tokens: missing access_token')
  return t
}

function _req (method, path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'api.linkedin.com',
      path: '/v2' + path,
      method,
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { _raw: data } }
        if (res.statusCode >= 400) {
          return reject(new Error('LinkedIn ' + res.statusCode + ': ' + (parsed.message || data.slice(0, 200))))
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed })
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

/**
 * Publish a post to LinkedIn immediately.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ text: string, authorUrn?: string, visibility?: string, shareUrl?: string, shareTitle?: string }} opts
 *   authorUrn: overrides the token's author_urn when provided (e.g. for org posts from a personal token)
 *   visibility: 'PUBLIC' | 'CONNECTIONS' (default 'PUBLIC')
 * @returns {Promise<{ id: string, status: string }>}
 */
export async function linkedinCreatePost (ctx, opts) {
  const log = ctx.log || (() => {})
  const tokens = _tokens(ctx.agentId)
  const authorUrn = opts.authorUrn || tokens.author_urn
  if (!authorUrn) throw new Error('linkedinCreatePost: authorUrn required (opts or token.author_urn)')
  log('info', '[linkedin] createPost', { authorUrn })

  const shareMedia = opts.shareUrl
    ? {
        shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: opts.shareUrl, title: { text: opts.shareTitle || '' } }],
      }
    : { shareMediaCategory: 'NONE' }

  const payload = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: opts.text },
        ...shareMedia,
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': opts.visibility || 'PUBLIC',
    },
  }

  const res = await _req('POST', '/ugcPosts', tokens.access_token, payload)
  const postId = res.headers['x-restli-id'] || res.body.id || null
  log('info', '[linkedin] post created', { postId })
  return { id: postId, status: 'published' }
}

/**
 * Schedule a LinkedIn post via the conductor job queue.
 * LinkedIn's public API does not support native scheduling; this returns a
 * job handle that the conductor job runner will execute at scheduleTime.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ text: string, authorUrn?: string, visibility?: string, shareUrl?: string, shareTitle?: string, scheduleTime: string }} opts
 *   scheduleTime: ISO8601
 * @returns {{ status: 'scheduled', scheduled_at: string, channel: string, job_payload: object }}
 */
export function linkedinSchedulePost (ctx, opts) {
  const log = ctx.log || (() => {})
  const { scheduleTime, ...postOpts } = opts
  log('info', '[linkedin] schedulePost queued', { scheduleTime })
  return {
    status: 'scheduled',
    scheduled_at: scheduleTime,
    channel: 'linkedin',
    job_payload: { type: 'linkedin_publish', params: postOpts },
  }
}

/**
 * Get engagement metrics for a LinkedIn post.
 * Requires the socialActions endpoint (v2).
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ shareUrn: string }} opts   "urn:li:share:{id}" or "urn:li:ugcPost:{id}"
 * @returns {Promise<{ likeCount: number, commentCount: number, shareCount: number, impressionCount: null }>}
 */
export async function linkedinGetPostMetrics (ctx, opts) {
  const log = ctx.log || (() => {})
  const tokens = _tokens(ctx.agentId)
  log('info', '[linkedin] getPostMetrics', { shareUrn: opts.shareUrn })

  const encoded = encodeURIComponent(opts.shareUrn)
  const res = await _req(
    'GET',
    '/socialActions/' + encoded + '?projection=(likesSummary,commentsSummary,sharesSummary)',
    tokens.access_token,
    null,
  )
  const b = res.body
  return {
    likeCount:       b.likesSummary?.totalLikes                        ?? 0,
    commentCount:    b.commentsSummary?.totalFirstLevelComments         ?? 0,
    shareCount:      b.sharesSummary?.shareCount                        ?? 0,
    impressionCount: null, // not available via socialActions; requires Marketing Analytics API
  }
}
