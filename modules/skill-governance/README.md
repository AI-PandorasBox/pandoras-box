# skill-governance

Skill governance layer for Pandora's Box (NVIDIA Agent-Skills pattern). Provides, with no
external dependencies (Node `crypto` only):

- **ed25519 detached signing + verification** of a skill's canonical file manifest.
- **Instruction-safety + supply-chain scan** (flags credential-exfil patterns, risky calls, etc.).
- **Skill-card generation** (a human-readable summary of a skill revision).
- **`gate()`** — a single entry point a skill revision must pass (scan → card + sign → verdict)
  before it is promoted/distributed.

## Why
Skills are executable instructions. Before one is promoted or shipped to other boxes, it must be
scanned for unsafe instructions/supply-chain risks and signed, so consumers can verify integrity
and provenance before applying it.

## CLI
```
node skill-governance.mjs keygen           # create the local signing keypair
node skill-governance.mjs scan   <skillDir>
node skill-governance.mjs sign   <skillDir>
node skill-governance.mjs verify <skillDir>
node skill-governance.mjs card   <skillDir>
node skill-governance.mjs gate   <skillDir>   # scan -> (if pass) card + sign -> verdict JSON
```

## Keys
The signing **private key lives OFF any repo** at `$PBOX_SKILL_KEY_DIR`
(default `<install>/shared/skill-signing`, mode 600). Only the public key is distributed so
consumers can verify. `install.sh` generates the keypair locally on first install.

## Install / uninstall
Installed by `pbox-setup.sh` via `install.sh` (stages the runtime into
`<install>/shared/modules/skill-governance/`). To uninstall, remove that directory and the
`shared/skill-signing` key dir.

## Kind
`library` — imported by other components (e.g. the fleet skill-sync verifier); no daemon, no ports.
