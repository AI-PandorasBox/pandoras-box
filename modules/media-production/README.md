# media-production

> **Autonomous Content Pipeline**

**Status:** Optional
**Depends on:** core

## What It Does

Autonomous content and media pipeline. Manages a theme queue, generates content on a
schedule, and publishes to configured platforms after your approval. Nothing is published
without your explicit sign-off.

### Content Generation

- **Music channel**: Generates 8-hour ambient focus music videos via ElevenLabs Music API.
  Produces a preview clip for approval before the full render. Publishes to YouTube weekly.
- **Social media**: Produces content drafts from a brief, topic, or rough idea. Publishes
  on instruction.

### Platforms

- YouTube (video upload via YouTube Data API v3)
- LinkedIn (via OAuth access token)
- More platforms can be added via the project system

## Monthly Cost

ElevenLabs API: approximately £10-30 additional per month for weekly music generation,
depending on clip length and render frequency. Social content generation adds minor
Anthropic API usage.

## How to Install

```
sudo bash modules/media-production/install.sh
```

## Uninstall

Remove `MEDIA_PRODUCTION_ENABLED=true` from `/opt/pandoras-box/muse/.env`. Restart the Personal Assistant.
