# conductor

> **Per-tenant orchestration daemon (v0.5.x)**
>
> **Status:** Auto-installed per-tenant by `setup-company.sh`. NOT operator-selectable in the main module menu.

The conductor is the per-tenant orchestration daemon. One conductor runs per company. It:

- Loads the relay driver (Discord / Slack / WhatsApp / browser) per the company's `RELAY_TYPE` env
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
