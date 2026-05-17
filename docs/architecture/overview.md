<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Architecture

![Six Layer Overview](diagrams/overview-designer.svg)

## Overview

Pandoras Box is a locally-hosted, multi-agent AI system designed to run on a single Mac. Each
agent has a narrowly defined scope and runs under its own OS service account. All inter-agent
communication passes through a shared job queue, and an independent oversight daemon reviews
every job before it executes.

The system is built natively for macOS using LaunchDaemons for process management. A Linux
port is planned. It does not require Docker or any cloud infrastructure -- all processing
happens on the host machine.

## Four-Tier Architecture

```
+--------------------------------------------------+
|  Tier 0: Admin agent                             |
|  CLI admin. No external connectivity.            |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|  Tier 1: Argus                                   |
|  Independent oversight daemon. Approves/blocks   |
|  every job. Cannot be instructed by agents.      |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|  Tier 2: Conductors  (one per company)           |
|  Receive messages. Route jobs. Hold no creds.    |
+--------------------------------------------------+
                        |
+--------------------------------------------------+
|  Tier 3: Task Agents (per company)               |
|  Mail / Calendar / Files / Voice                 |
|  Scoped credentials. OS-isolated per company.    |
+--------------------------------------------------+
```

| Tier | Name | Role | Key constraint |
|------|------|------|----------------|
| 0 | Admin agent | System administrator. Manages infrastructure, deploys, and monitors services. | No external connectivity. Runs as admin user only. |
| 1 | Argus | Independent oversight daemon. Approves or blocks every job before execution. | Cannot be instructed by any agent or conductor. Standalone process. |
| 2 | Conductors | One per company. Receives inbound messages. Routes work to the job queue. | Holds no company credentials. Routing only. |
| 3 | Task Agents | Mail, Calendar, Files, and Voice -- one set per company. Execute approved jobs. | Scoped credentials only. OS-isolated per company. Cannot call tools outside their scope. |

Communication rule: a lower-numbered tier cannot instruct a higher-numbered tier. Task agents
cannot instruct conductors. Conductors cannot instruct Argus. Nothing instructs the admin agent except the
human operator.

## Component Reference

### The admin agent

**Role:** System administrator and operator interface.

**Key responsibilities:**
- Deploy code changes and configuration updates
- Monitor service health and restart failed daemons
- Review and authorise Argus mitigation reports
- Manage tenant provisioning and credential rotation

**Path pattern:** `/Users/your-admin-username/Desktop/pandoras-box-admin/`

**Log:** Console output only (interactive CLI session)

---

### Argus

**Role:** Independent oversight daemon.

**Key responsibilities:**
- Poll the job queue every 60 seconds
- Approve or block each pending job based on type, payload, and rate rules
- Track N-strike quarantine counters per conductor
- Run dependency and security scans on a weekly schedule

**Path pattern:** `/opt/pandoras-box/argus/`

**LaunchDaemon label:** `com.pandoras-box.argus`

**Log:** `/tmp/pandoras-box-argus.log`

---

### Conductors

**Role:** Per-company message intake and routing.

**Key responsibilities:**
- Receive inbound messages from the relay (Telegram, Discord, Slack, etc.)
- Classify the message type (email task, calendar task, files task, etc.)
- Write a job record to the queue with company_id and task_type
- Return a reply once the job completes

**Path pattern:** `/opt/pandoras-box/company-a-conductor/`

**LaunchDaemon label:** `com.pandoras-box.company-a-conductor`

**Log:** `/tmp/pandoras-box-company-a-conductor.log`

---

### Task Agents

**Role:** Execution layer. One set per company (mail, calendar, files, voice).

**Key responsibilities:**
- Poll the job queue for approved jobs matching their company and task type
- Execute the job using scoped credentials (mail OAuth, calendar OAuth, etc.)
- Write the result back to the job record
- Never access credentials belonging to another company

**Path pattern:** `/opt/pandoras-box/company-a-mail/`

**LaunchDaemon label:** `com.pandoras-box.company-a-mail`

**Log:** `/tmp/pandoras-box-company-a-mail.log`

---

### The Personal AI

**Role:** Owner personal AI. Cross-company read access for the operator.

**Key responsibilities:**
- Unified inbox, calendar view, and briefing for the operator
- Accessible via browser UI (admin-lite module)
- Holds read tokens for all companies (by design -- serves the operator only)

**Path pattern:** `/opt/pandoras-box/muse/`

**LaunchDaemon label:** `com.pandoras-box.muse`

**Log:** `/tmp/pandoras-box-muse.log`

**Supplementary services:**

| Service | Label | Description |
|---------|-------|-------------|
| Voice call server | `com.pandoras-box.muse-call` | WebSocket bridge (port 8890, Tailscale-only). Routes voice calls from the watch companion through speech-to-text, the personal AI conductor, and text-to-speech. No LLM cost. |
| Health intelligence | `com.pandoras-box.personal-sensor-signals` | Rules-based ambient signal evaluation. Runs every 60 minutes. Writes structured state for the personal AI to read. No LLM cost. |

---

### Health Intelligence Service

**Role:** Ambient signal detection layer for the owner's personal AI.

**Key responsibilities:**
- Poll configured data sources every 60 minutes
- Evaluate signal thresholds against configurable rules
- Write structured signal state for the personal AI conductor to read
- Respect quiet hours (configurable silent window)
- Rate-limit push triggers (configurable daily maximum)

**Design principle:** Zero LLM cost at this layer. The signal service detects; the personal AI
conductor decides whether to act (alert, action, or ignore). LLM cost is incurred only when
the conductor processes a signal.

**Path pattern:** `/opt/pandoras-box/muse/`

**LaunchDaemon label:** `com.pandoras-box.personal-sensor-signals`

**Log:** `/tmp/pandoras-box-personal-sensor-signals.log`

---

## Job Queue

The job queue is a SQLite database at `/var/ai-jobs/jobs.db`. All inter-tier communication
passes through it.

**Lifecycle:**

```
[conductor writes job]
        |
        v
    pending
        |
        v  [Argus reviews within 60s]
   approved  -------> blocked
        |                 |
        v                 v
  [task agent          [job stays blocked,
   executes]            alert sent]
        |
        v
  complete / failed
```

**Schema:**

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| company | TEXT | Company slug (e.g. company-a) |
| task_type | TEXT | email, calendar, files, voice, briefing, etc. |
| payload | TEXT | JSON-encoded task parameters |
| status | TEXT | pending, approved, blocked, complete, failed |
| created_at | TEXT | ISO 8601 timestamp |

---

## Local LLM (Ollama)

The `ollama` module is optional. When installed, conductors use a local LLM for high-volume
message classification instead of the Anthropic API. This significantly reduces API costs for
busy inboxes.

- Default model: `gemma3:12b`
- Minimum RAM: 16 GB
- Install: `brew install ollama && ollama pull gemma3:12b`
- Conductors auto-detect Ollama at startup and fall back to the Anthropic API if unavailable.

---

## Scheduled Automations

| Name | Schedule | Description |
|------|----------|-------------|
| Morning briefing | 07:30 daily | The Personal AI generates a summary of emails, calendar, and tasks |
| Email poll | 08:00, 13:00, 18:00 | Task agents check for new email and queue replies |
| Watchdog | 08:00, 20:00 daily | Hash-checks key system files against baseline |
| Token refresh | 07:55 daily | Refreshes MS365 and Google OAuth tokens before agents start |
| Dependency scan | Thursday 17:30 | Argus scans npm packages and GitHub versions for updates |
| Self-improvement | Weekly (Saturday) | the Self-Improvement Pipeline GEPA optimisation cycle (if installed) |
| Health intelligence | Every 60 minutes | Rules-based ambient signal check; writes state for personal AI (if watch-companion installed) |

---

## Installation Paths

A two-company installation with mail and calendar modules looks like this:

```
/opt/pandoras-box/
  argus/                         # Oversight daemon
  muse/                          # Owner personal AI
  company-a/                     # Base dir: shared node_modules + credentials
  company-a-conductor/           # Conductor for Company A
  company-a-mail/                # Mail agent for Company A
  company-a-calendar/            # Calendar agent for Company A
  company-a-files/               # Files agent for Company A
  company-a-voice/               # Voice agent for Company A
  company-b/                     # Base dir: shared node_modules + credentials
  company-b-conductor/           # Conductor for Company B
  company-b-mail/                # Mail agent for Company B
  company-b-calendar/            # Calendar agent for Company B
  company-b-files/               # Files agent for Company B
  company-b-voice/               # Voice agent for Company B

/var/ai-jobs/
  jobs.db                        # Shared SQLite job queue

/Library/LaunchDaemons/
  com.pandoras-box.argus.plist
  com.pandoras-box.company-a-conductor.plist
  com.pandoras-box.company-a-mail.plist
  com.pandoras-box.company-a-calendar.plist
  com.pandoras-box.company-a-files.plist
  com.pandoras-box.company-a-voice.plist
  com.pandoras-box.company-b-conductor.plist
  ... (and so on for Company B)
  com.pandoras-box.muse-call.plist
  com.pandoras-box.personal-sensor-signals.plist
```
