# video-publisher

> **Automated Video Production**

**Status:** Optional
**Depends on:** core, personal-ai

## What It Does

Automated video production and YouTube publishing. Generates scripts, synthesises voice
(ElevenLabs), assembles video (ffmpeg), and publishes to YouTube.

All videos go through your approval queue before publishing.

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
