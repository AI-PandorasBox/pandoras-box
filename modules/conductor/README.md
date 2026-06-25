# conductor

> **Per-tenant orchestration daemon**
>
> **Status:** Available now. Auto-installed per-tenant by `setup-company.sh`. NOT operator-selectable in the main module menu.

The conductor is the per-tenant orchestration daemon, and it ships and runs in this release. One conductor runs per company. It:

- Loads the relay driver per the company's `RELAY_TYPE` env. The default is the built-in browser/localhost-HTTP relay, which works out of the box and binds to `127.0.0.1` only. The Discord / Slack / WhatsApp relay drivers are roadmap and not yet available.
- Receives incoming messages, classifies them by `task_type`, inserts jobs into the per-tenant `<slug>/store/jobs.db` queue
- Polls for COMPLETED jobs and routes results back via the relay driver
- Maintains conversation memory in `<slug>/store/conversations.db`
- Never touches provider credentials directly — task agents read those from their own per-tenant `.env`

## Architecture

See `docs/architecture/v0.5-multi-tenant.md` for the pinned contract (env vars, dir layout, jobs.db schema, status workflow).

## Install

Installed automatically when a company is added via `pbox-setup.sh` → company setup. Not a standalone install.

## Dependencies

`@anthropic-ai/claude-agent-sdk`, `discord.js`, `@slack/bolt`, `whatsapp-web.js`, `qrcode-terminal`, `dotenv`. Pinned in `runtime/package.json`.
