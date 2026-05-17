# ollama

> **Local LLM (On-Device)**

**Status:** Optional
**Depends on:** core

## What It Does

Runs a local AI model on your Mac for message classification and routing decisions.
Conductors use Ollama for the high-volume, mechanical parts of their work, calling the
Anthropic API only for complex reasoning and generation.

Result: 30-70% reduction in Anthropic API costs for busy installations.

Default model: `gemma3:12b` (~8 GB download, ~10 GB RAM when loaded)

## Requirements

- 16 GB RAM minimum (8 GB possible with a smaller model like `gemma3:4b`)
- ~10 GB free disk space for the model
- Ollama: `brew install ollama`

## Monthly Cost

No API cost for Ollama itself. Reduces Anthropic API costs significantly.

## How to Install

```
sudo bash modules/ollama/install.sh
```

## Monitoring

```
ollama list          -- see installed models
ollama ps            -- see currently loaded models
```

## Uninstall

```
ollama rm gemma3:12b
brew uninstall ollama
```

Remove `OLLAMA_HOST` and `OLLAMA_MODEL` from `${INSTALL_PATH:-/opt/pandoras-box}/theme.conf`.
Conductors will fall back to the Anthropic API automatically.
