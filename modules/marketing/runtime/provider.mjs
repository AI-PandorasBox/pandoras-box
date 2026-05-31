// ${MODULE_HOME}/provider.mjs
// Marketing module provider -- aggregates Mailchimp, LinkedIn, and Meta API clients.
// Agents and conductors import named tool functions from here.
//
// Exported names match the manifest tool declarations in catalogue/modules/marketing.yaml:
//   mailchimpCreateCampaign, mailchimpScheduleCampaign, mailchimpGetAudienceStats
//   linkedinCreatePost, linkedinSchedulePost, linkedinGetPostMetrics
//   metaCreatePost, metaSchedulePost, metaGetPostInsights

export { mailchimpCreateCampaign, mailchimpScheduleCampaign, mailchimpGetAudienceStats } from './mailchimp.mjs'
export { linkedinCreatePost, linkedinSchedulePost, linkedinGetPostMetrics } from './linkedin.mjs'
export { metaCreatePost, metaSchedulePost, metaGetPostInsights } from './meta.mjs'
