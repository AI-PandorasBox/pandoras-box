# Operator Workflow — Session Start, Deploy, Session Close

<!-- _OPERATOR_WORKFLOW_V1 -->

This is the day-to-day operating loop for the **admin agent** (Layer 0) and the operator. It exists so that from day one you have a repeatable, safe workflow rather than ad-hoc changes. The admin agent should follow these three phases every working session.

> **Status note (read me):** as of v0.x the installer does **not** yet ship these phases as a baked-in admin-agent operating document. This file is the canonical description; a follow-up ships it into the admin agent's prompt so a fresh install has the workflow from day one. Until then, paste the relevant phase into your admin agent or keep this open.

---

## 1. Session Start

Run these checks at the very start of every admin session, before taking any request:

1. **Recent changes** — read the last entries of the change log (`CHANGELOG`) so you know what shipped, what is pending, and what is mid-flight.
2. **Open threads** — read the last session record (`memory/sessions.md` or equivalent) and surface any `OPEN:` items from the previous session.
3. **Inbound messages** — check the message channel the Personal AI / agents use to flag things to the admin (process anything unactioned).
4. **Project board** — scan projects for `blocked` (needs you), `review_needed` (staged, awaiting review), and `brief_ready` (assess + approve) states.
5. **Service health** — confirm the agents, conductors, and oversight daemons are running and have a clean last-exit.

Report in order: open threads, pending deploys, blocked/review projects, then wait for the operator's first request. Do not start work before the checks.

---

## 2. Deploy Process

Every change that touches a running service follows the same gated path. **Nothing deploys automatically** — each step is explicit and operator-authorised.

1. **Scope gate** — before writing any deploy script, state *every* file, service, plist, `.env`, and job that will be touched. Wait for the operator to confirm the scope is correct.
2. **Security impact** — state a short impact assessment (credentials, network surface, privilege, audit trail, tenant isolation). Routine changes may state "none"; anything touching secrets, ports, or new daemons gets the full table.
3. **Changelog first** — write the change-log entry *before* the deploy script, not after.
4. **Author the deploy** — write `deploy.sh` with `DRY_RUN=true`, a backup step first, a syntax/`--check` step for every changed file, and an auto-rollback on failure. Restart only the affected service.
5. **Review + flip** — operator reviews the staged change, then authorises flipping `DRY_RUN=false`.
6. **Run + verify** — run the deploy, then functionally verify (a green service status is *not* a pass — exercise the actual change). Re-baseline any file-integrity watcher after the change.

For multi-step work, pre-build every step staged with `DRY_RUN=true` before the first deploy, so the operator never waits for code between deploys.

---

## 3. Session Close / Handover

Before ending a session, complete these in order so the next session (or operator) starts clean:

1. **Action inbound** — mark any agent/Personal-AI messages processed this session as actioned.
2. **Session record** — append an entry to the session log: date, what changed (deploys, fixes, investigations), and an explicit `OPEN:` list of unresolved items, pending decisions, and next steps.
3. **Changelog** — ensure every deploy that ran has a change-log entry (what / why / security note / packages / deploy label).
4. **Error log** — if any deploy needed a rerun or hit an error, record it (date, label, error, root cause, fix, which gate would have caught it) so the self-improvement loop can turn recurring failures into rules.

These steps are not optional. If you close early for an incident, complete them once it is resolved.

---

## Why this matters

The three phases give you: a known-good starting state every session, a deploy path that cannot silently break production, and a handover trail so work is never lost between sessions. The oversight daemon (**Argus**) and the file-integrity baseline depend on the deploy discipline above; the **Self-Improvement Pipeline** consumes the error log to propose durable fixes. See [`architecture/subsystems.md`](../architecture/subsystems.md) for how those subsystems work.
