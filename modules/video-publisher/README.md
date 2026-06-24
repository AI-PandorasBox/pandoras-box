# video-publisher

> **Automated Video Production (PLANNED -- not yet implemented)**

**Status:** PLANNED -- not yet implemented
**Depends on:** core, personal-ai

## What It Does

> **This module is not implemented yet.** The directory provisions credentials but
> ships no runtime, so it does not produce or publish video in this release. The
> description below is the planned design. For shipped video capability today, use
> the `media-production` and `youtube-publishing` modules.

Planned: automated video production and YouTube publishing -- generate scripts,
synthesise voice (ElevenLabs), assemble video (ffmpeg), and publish to YouTube,
with every video routed through your approval queue before publishing.

## Monthly Cost

- ElevenLabs: approximately £1-5 per video depending on script length
- Anthropic API: approximately £2-5 per video for script generation
- YouTube: free

## How to Install

```
sudo bash modules/video-publisher/install.sh
```

## Uninstall

Remove `VIDEO_PUBLISHER_ENABLED=true` from `/opt/pandoras-box/video-publisher/.env`.
`brew uninstall ffmpeg` if no longer needed.
