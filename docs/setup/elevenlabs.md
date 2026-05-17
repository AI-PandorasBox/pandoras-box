<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Setup — ElevenLabs (voice synthesis)

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

ElevenLabs powers the Voice module's text-to-speech. Each agent can speak in a chosen voice — the Personal AI typically has one voice; business agents may have different voices to distinguish them in calls.

## Prerequisites

- ElevenLabs account at https://elevenlabs.io.
- A paid plan (free tier limits TTS minutes and excludes some voices).

## Setup steps

### 1. Get an API key

Sign in at https://elevenlabs.io → click your profile → **Profile + API key** → copy the API key.

### 2. Pick voices

Browse the voice library at https://elevenlabs.io/voice-library — pick voices that match each agent's tone. Note the **voice ID** for each (looks like `21m00Tcm4TlvDq8ikWAM`).

You can also clone a custom voice or use a stock voice — both work. The installer asks which voice ID to assign to each agent.

### 3. Store the API key in Keychain

```
security add-generic-password -s ELEVENLABS_API_KEY -a default -w
```

Paste the key when prompted. The installer does this for you if you're running the Voice module setup interactively — manual step is for re-installs.

### 4. Per-agent voice mapping

The installer asks for a voice ID per agent. Stored in `/opt/pandoras-box/<tenant>/voice-config.json`:

```
{
  "personal_ai": "21m00Tcm4TlvDq8ikWAM",
  "business_agent": "AZnzlk1XvdvUeBnXmlld"
}
```

You can edit this file later to swap voices without re-running the installer.

## Verifying it works

After setup, send to your Personal AI:

```
say hello in your voice
```

You'll get an audio response in the Personal AI UI's voice player.

## Cost guidance

ElevenLabs charges per character of TTS audio. A typical Pandora's Box install uses ~50k characters / month — well under most plan caps. The Voice module logs character counts so you can review usage.

## Revoking access

Delete the API key at https://elevenlabs.io profile → API key → **Revoke**. Then:

```
security delete-generic-password -s ELEVENLABS_API_KEY
```

Voice module stops working immediately. Other modules unaffected.
