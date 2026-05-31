# Marketing

Draft and publish marketing content across channels (LinkedIn, Mailchimp, Meta). Each channel is optional and only activates when its credential is set. All outbound posts pass the oversight/classifier layer before sending.

## Provides
- `marketing`
- `social-post`
- `email-campaign`

## Requires
- `core`

## Configuration
- `LINKEDIN_TOKEN` — LinkedIn API token (optional)
- `MAILCHIMP_API_KEY` — Mailchimp API key (optional)
- `META_TOKEN` — Meta Graph API token (optional)

## Enabling
Optional module. Ships disabled; enable per-agent in the activation matrix.
