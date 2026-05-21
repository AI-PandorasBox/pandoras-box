# Setup guides — overview

<!-- _A2_INSTALLER_AND_GUIDES_V1 -->

Each guide in this folder covers one external dependency or third-party service that Pandora's Box can integrate with. You only need the guides for the modules and add-ons you actually install — the interactive installer skips deps you didn't pick.

| Guide | When you need it |
|---|---|
| [macOS iCloud Drive](icloud.md) | **Always — do this first.** Disable Desktop & Documents folder sync before installing |
| [Anthropic auth](anthropic.md) | Always — Claude Pro/Max subscription or API key powers the bridge |
| [Microsoft 365](ms365.md) | Mail / Calendar / Files modules for any business tenant on Office 365 |
| [Tailscale](tailscale.md) | Personal AI mobile access (strongly recommended) |
| [ElevenLabs](elevenlabs.md) | Voice module (TTS for spoken agent responses) |
| [Google AI](google-ai.md) | Imagen image generation, Veo video, Gemini Live frame analysis |
| [YouTube](youtube.md) | the Media Production Pipeline publishing automation |
| [Obsidian](obsidian.md) | Vault Graph module (memory + relationship visualisation) |
| [Docker](docker.md) | the Offline Knowledge Library offline knowledge (Kiwix container) |
| [IG.com trading](ig-trading.md) | the Trading Research Agent trading agent — disclaimer applies |

## Setup ordering

Most operators follow this order:

1. **macOS iCloud Drive** — disable Desktop & Documents folder sync and Optimize Mac Storage before anything else. See the [iCloud guide](icloud.md). Skipping this risks silent file eviction and corrupted backups.
2. **Anthropic** — get Claude Pro/Max subscription active first; the installer's first step is to sign in via `claude /login`.
3. **Tailscale** — install it across your devices early; later steps assume your phone can reach the Mac.
4. **Microsoft 365** — for each business tenant, register the Azure AD app once. The installer guides you through it interactively.
5. **Optional add-ons** — ElevenLabs / Google AI / Obsidian / Docker / YouTube / IG only if you've picked the modules that need them.

## Credential storage

All API keys land in the macOS Keychain via `security add-generic-password` calls. The installer issues these for you and prompts for the values when needed. You never paste keys into config files.

## If a setup step fails

The installer is idempotent — re-running it picks up where it stopped. Each guide here lists the exact command to retry that step manually:

```
sudo bash /opt/pandoras-box/scripts/add-module.sh <module-name>
```

## If you need to revoke access later

Each guide ends with a "Revoking access" section that walks you through removing the Pandora's Box app registration / token / API key on the third-party side. Doing that disables the corresponding agent feature; the rest of the system keeps running.
