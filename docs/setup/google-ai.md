<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Setup — Google AI Studio (Imagen / Veo / Gemini)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

Google AI Studio gives Pandora's Box access to:

- **Imagen 3** — image generation (hero images, social posts, slide imagery)
- **Veo** — video generation (the Media Production Pipeline's long-form video pipeline)
- **Gemini Live** — real-time frame analysis (Live Stream Vision module)
- **Gemini 2.5 Flash** — fallback LLM for non-Anthropic tasks (image-aware QA)

## Prerequisites

- A Google account (any consumer Gmail or Workspace account).
- Access to https://aistudio.google.com (free for basic tier; paid quotas available).

## Setup steps

### 1. Get an API key

Sign in at https://aistudio.google.com → **Get API key** → **Create API key in new project** (or pick an existing GCP project if you have one).

Copy the key (39 characters total — starts with `AIza`, format `AIzaSy<35-char-key-tail>`).

### 2. Check entitlements

Not all models are available on every tier. Verify you have access to:

- `gemini-2.5-flash-image` (Imagen via Gemini — used by `generate_image` tool)
- `imagen-3.0-generate-001` (Imagen 3 — used by presentation pipeline)
- `veo-3.0` (Veo — used by the Media Production Pipeline video pipeline)
- `gemini-2.0-flash-live` (Gemini Live — used by Live Stream Vision module)

On the free tier, Imagen and Gemini Flash are typically enabled by default. Veo requires a paid plan. Live Stream Vision requires a paid plan with Gemini Live entitlement.

If a model isn't in your project, navigate to https://console.cloud.google.com → APIs & Services → Library → search for the model → Enable.

### 3. Store the API key in Keychain

```
security add-generic-password -s GOOGLE_API_KEY -a default -w
```

Paste the key when prompted.

### 4. Configure spend caps (recommended)

In Google AI Studio settings, set a daily spend limit. The installer asks for your preferred cap; default is £5/day for personal installs and £20/day for multi-tenant production installs. The the Media Production Pipeline module also has internal soft caps to prevent runaway spend on video generation.

## Cost guidance per module

| Module | Typical monthly cost (UK GBP, personal install) |
|---|---|
| Image generation (Imagen via Gemini Flash) | £1-£5 |
| Presentation image pipeline (Imagen 3) | £2-£10 |
| the Media Production Pipeline video (Veo) | £10-£40 — depends on minutes of generated video |
| Live Stream Vision (Gemini Live) | £5-£20 per heavy day; opt-in per session |

Heavy installs can hit £100+ per month if the Media Production Pipeline and Live Stream Vision are both run frequently. Monitor your AI Studio billing page weekly.

## Verifying it works

After setup, ask your Personal AI:

```
generate an image of a translucent obsidian box opening
```

You should see an image in the Personal AI UI's Create tab. If you see an error, check:
1. Keychain entry: `security find-generic-password -s GOOGLE_API_KEY`
2. AI Studio key is active (not deleted)
3. Project has the model enabled

## Revoking access

Delete the key at https://aistudio.google.com → API keys → revoke. Then:

```
security delete-generic-password -s GOOGLE_API_KEY
```

Image / Veo / Gemini-Live features stop working immediately.
