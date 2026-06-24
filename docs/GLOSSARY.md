# Glossary — Pandora's Box terminology

One vocabulary, used consistently across the README, the manuals, the dashboard,
and the module registry. Where Pandora's Box builds on Anthropic's Claude, we use
Claude's own terms rather than inventing new ones.

## Claude terms (used as Anthropic defines them)

| Term | Meaning here |
|------|--------------|
| **Claude** | Anthropic's model family. Pandora's Box runs on your **Claude Pro or Max subscription** (browser sign-in), not a pay-per-token API key. |
| **Claude Code** | Anthropic's command-line coding tool. The admin agent uses it as its interface; the Personal AI does **not**. |
| **MCP (Model Context Protocol)** | The open standard Claude uses to reach external systems. Pandora's Box ships **MCP connectors** for Gmail, Microsoft 365, calendar and files. |
| **Tool / tool use** | A single callable function the model can invoke (Claude's "tool use"). In Pandora's Box, tools are the individual actions an agent can take (e.g. send-email, get-calendar-view). |
| **System prompt** | The instructions that define an agent's behaviour. Each agent's system prompt is built from a shipped **operating guide** (`CLAUDE.md`) plus its memory. |

## Pandora's Box terms

| Term | Meaning here |
|------|--------------|
| **Module** | An installable unit listed in `modules/registry.json`. A module is either a **service** (a daemon, e.g. dashboard, docs-server), a **config** (wires a capability, e.g. mail-google), or a **skill-pack** (a library of skills). The installer's catalogue is the set of modules. |
| **Skill** | A reusable, tenant-agnostic capability primitive in the skills library (`shared/skills/library/<name>/`), defined by a `SKILL.md` + its code. Any agent with the right access can invoke a skill. Distinct from a *tool*: a tool is one model-callable function; a skill is a packaged multi-step capability built from tools. |
| **Agent** | An AI worker with its own identity, memory, and scope. Three tiers: the **admin agent** (runs the platform), the per-company **conductor** (routes a company's work), and **task agents** (mail / calendar / files / voice — one per function per company). |
| **Conductor** | The per-company orchestrator agent. Receives messages, classifies intent, routes jobs to its task agents. Holds no provider credentials itself. |
| **Personal AI** | The owner's own browser-based assistant (chat, briefing, tasks, notes, research, files, voice). Separate from the company agents. |
| **Operating guide** | The `CLAUDE.md` shipped per agent (admin / personal-ai / conductor templates in `config/`) that defines its behaviour, data-integrity, and safety rules. |
| **Subsystem** | A named platform layer surfaced in the dashboard's Subsystems view (security, memory, self-improvement, agents). |
| **Capability** | A thing the system can do for the user, provided by one or more modules (e.g. "calendar" capability provided by the calendar module + an MCP connector). |

## The four platform layers

1. **Security** — the oversight daemon + the content classifier, reviewing every queued job before it runs.
2. **Memory** — rolling history + semantic recall + structured knowledge (facts, drops, notes).
3. **Self-improvement** — a weekly digest of proposed prompt improvements; nothing self-applies without approval.
4. **Operating guides** — the per-agent `CLAUDE.md` files that ship with the install.

## Counts (this release)

40 modules · {{TOOL_COUNT}} tools (the tools listed in the shipped catalogue; many require you to connect your own accounts/keys) · 15 packaged skills (2 hand-built + 13 promoted) · 12 Personal AI surfaces · 8 connectors · 3 agent tiers · 4 platform layers. (Capability terms per CLASS-001.)
