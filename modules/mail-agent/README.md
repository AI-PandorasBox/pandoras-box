# mail-agent

> **Per-tenant mail task agent**
>
> **Status:** Available now. Auto-installed per-tenant by `setup-company.sh`. NOT operator-selectable in the main module menu.

The mail task agent runs once per tenant. It polls the per-tenant `<slug>/store/jobs.db` for APPROVED jobs of `task_type='mail'`, executes them via `@anthropic-ai/claude-agent-sdk`, and writes results back to the same DB. Operates under the tenant's service-account UID.

## Architecture

See `docs/architecture/v0.5-multi-tenant.md` for the pinned contract (env vars, dir layout, jobs.db schema, status workflow, heartbeat).

## Provider routing

- Microsoft 365 (`MS365_CLIENT_ID` set): the supported provider today. Reads via `@softeria/ms-365-mcp-server`.
- Google / Gmail (`GOOGLE_CLIENT_ID` set): **preview, not functional** in this release. No Gmail MCP server ships yet, so the agent cannot act on Gmail even when these credentials are present.
- If both are set: Microsoft 365 is the one that works today.
- If neither: agent logs a clear "no provider configured" error and waits

## Install

Installed automatically when a company is added via `pbox-setup.sh` → company setup. Loaded conditionally:
- Loaded iff `GOOGLE_CLIENT_ID` or `MS365_CLIENT_ID` is set in the company `.env`

## Dependencies

`@anthropic-ai/claude-agent-sdk`, `@softeria/ms-365-mcp-server`, `googleapis`, `dotenv`. Pinned in `runtime/package.json`.

## Audit log

Writes per-job audit entries to `<slug>/logs/audit.log` (operator-readable). Includes tool calls, secret-scan hits on outbound, retry-cap triggers, and final job status.
