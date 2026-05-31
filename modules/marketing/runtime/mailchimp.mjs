// ${MODULE_HOME}/mailchimp.mjs
// Mailchimp Marketing API v3 client for the Pbox marketing module.
// Credentials loaded via module-cred-scope (keychain pointer per marketing.yaml manifest).
// API key format: xxxxxx-usN (dc derived from suffix).

import https from 'node:https'
import { loadCred } from '../../module-cred-scope.mjs'

function _creds (agentId) {
  const apiKey = loadCred(agentId, 'marketing', 'mailchimp_api_key')
  const dc = apiKey.split('-').pop()
  if (!dc || !/^us\d+$/.test(dc)) throw new Error('malformed Mailchimp API key -- expected xxx-usN format')
  return { apiKey, dc }
}

function _req (dc, method, path, apiKey, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null
    const auth = Buffer.from('anystring:' + apiKey).toString('base64')
    const req = https.request({
      hostname: dc + '.api.mailchimp.com',
      path: '/3.0' + path,
      method,
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { _raw: data } }
        if (res.statusCode >= 400) {
          return reject(new Error('Mailchimp ' + res.statusCode + ': ' + (parsed.detail || parsed.title || data.slice(0, 200))))
        }
        resolve(parsed)
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

/**
 * Create a Mailchimp regular campaign, optionally setting HTML or template content.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ listId: string, subject: string, previewText?: string, fromName: string, replyTo: string, htmlContent?: string, templateId?: number }} opts
 * @returns {Promise<{ id: string, webId: number, status: string }>}
 */
export async function mailchimpCreateCampaign (ctx, opts) {
  const log = ctx.log || (() => {})
  const { apiKey, dc } = _creds(ctx.agentId)
  log('info', '[mailchimp] createCampaign', { listId: opts.listId, subject: opts.subject })

  const campaign = await _req(dc, 'POST', '/campaigns', apiKey, {
    type: 'regular',
    recipients: { list_id: opts.listId },
    settings: {
      subject_line: opts.subject,
      preview_text: opts.previewText || '',
      from_name: opts.fromName,
      reply_to: opts.replyTo,
    },
  })

  if (opts.htmlContent) {
    await _req(dc, 'PUT', '/campaigns/' + campaign.id + '/content', apiKey, { html: opts.htmlContent })
  } else if (opts.templateId != null) {
    await _req(dc, 'PUT', '/campaigns/' + campaign.id + '/content', apiKey, { template: { id: opts.templateId } })
  }

  log('info', '[mailchimp] campaign created', { id: campaign.id, status: campaign.status })
  return { id: campaign.id, webId: campaign.web_id, status: campaign.status }
}

/**
 * Schedule an existing Mailchimp campaign.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ campaignId: string, scheduleTime: string }} opts   scheduleTime: ISO8601 UTC
 * @returns {Promise<{ id: string, status: string, scheduled_at: string }>}
 */
export async function mailchimpScheduleCampaign (ctx, opts) {
  const log = ctx.log || (() => {})
  const { apiKey, dc } = _creds(ctx.agentId)
  log('info', '[mailchimp] scheduleCampaign', { campaignId: opts.campaignId, scheduleTime: opts.scheduleTime })

  await _req(dc, 'POST', '/campaigns/' + opts.campaignId + '/actions/schedule', apiKey, {
    schedule_time: opts.scheduleTime,
  })

  log('info', '[mailchimp] campaign scheduled', { campaignId: opts.campaignId })
  return { id: opts.campaignId, status: 'scheduled', scheduled_at: opts.scheduleTime }
}

/**
 * Get audience stats for a Mailchimp list.
 *
 * @param {{ log?: function, agentId: string }} ctx
 * @param {{ listId: string }} opts
 * @returns {Promise<{ memberCount: number, unsubscribeCount: number, openRate: number, clickRate: number }>}
 */
export async function mailchimpGetAudienceStats (ctx, opts) {
  const log = ctx.log || (() => {})
  const { apiKey, dc } = _creds(ctx.agentId)
  log('info', '[mailchimp] getAudienceStats', { listId: opts.listId })

  const list = await _req(dc, 'GET', '/lists/' + opts.listId + '?fields=stats', apiKey, null)
  const s = list.stats || {}
  return {
    memberCount:      s.member_count      ?? 0,
    unsubscribeCount: s.unsubscribe_count ?? 0,
    openRate:         s.open_rate         ?? 0,
    clickRate:        s.click_rate        ?? 0,
  }
}
