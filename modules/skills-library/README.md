# Skills Library module

Installs the shared **skills library** -- reusable, tenant-agnostic skill
primitives that any agent can invoke when it has the required access. Skills are
pool primitives: one code path, no per-company logic baked in. Company-specific
defaults live in the agent activation layer, never inside a skill.

## What it installs

Skills are copied to `$INSTALL_PATH/shared/skills/library/<skill>/`.

| Skill | What it does |
|-------|--------------|
| `build_board_pack_from_calendar` | Builds a board-pack PDF from MS365 calendar data: per-week pull with retry/resume, exceljs xlsx assembly with row-count verification, Chrome-headless PDF render. Tenant-agnostic; optional branding preset. |

## Requirements

- Node 18+ on PATH.
- Node modules used by the skills (e.g. `exceljs`) -- provided by the
  **personal-ai** module. The board-pack skill resolves them from
  `/opt/pandoras-box/personal-ai/runtime` by default; override with
  `PBOX_NODE_BASE`.
- A calendar MCP (the personal-ai module) for the board-pack skill.

## Install

Offered by the module picker during `pbox-setup.sh`, or re-run later:

```
sudo bash /opt/pandoras-box/scripts/add-module.sh   # pick "Skills library"
# or directly:
sudo bash /opt/pandoras-box/modules/skills-library/install.sh
```

The installer is idempotent. Existing skills are refreshed; operator-specific
branding presets you add under `presets/` are never overwritten.

## Adding your own skill

Drop a `<skill-name>/` dir under this module's `skills/` containing a `SKILL.md`
manifest plus the skill's `.mjs` files, then re-run the installer. Keep skills
tenant-agnostic; put per-company defaults in agent activation.
