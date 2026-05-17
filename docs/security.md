<!-- _A6_1_NARRATIVE_SCRUB_V1 -->
# Security Architecture

## Overview

Pandoras Box is designed to run multiple AI agents on a single machine serving multiple
companies. The primary security concern is cross-tenant data leakage -- an agent for one
company must never be able to read, write, or act on data belonging to another company. The
architecture addresses this through OS-level isolation, an independent oversight daemon, and
per-agent tool allowlists.

## OS-Level Tenant Isolation

Each company is assigned a dedicated OS service account. All processes for that company run
under that account and can only access that account's files.

| Control | Value |
|---------|-------|
| Service account | One per company (e.g. `company-a-agent`) |
| Base directory permissions | `750` (owner: service account) |
| Credential files | `600` (readable only by service account) |
| Token cache files | `640` (readable by service account + admin group) |
| Job queue partitioning | Every job record includes `company_id`; agents filter by their own company only |

What this prevents:
- An agent for Company B cannot read Company A's email credentials
- An agent for Company A cannot read Company B's job queue entries
- A compromised task agent cannot escalate to another company's process

## Argus -- Independent Oversight Daemon

Argus is a standalone daemon running under its own service account (`argus`). It is not a
Claude agent and cannot be instructed by any conductor, task agent, or operator message.
The admin agent can only interact with the oversight daemon by reviewing its output and running pre-approved mitigation
scripts.

Argus reviews every job in the queue before it executes. Checks include:

- **Job type allowlist:** Only known, expected job types are approved. Unknown types are blocked.
- **Payload inspection:** Payloads are checked for anomalous size, unexpected fields, or patterns
  associated with prompt injection or instruction override attempts.
- **Rate limiting (N-strike):** If a conductor submits N consecutive blocked jobs, Argus stops the
  conductor, quarantines it, and sends an alert.
- **Resource usage:** Argus monitors process memory and CPU. Abnormal spikes trigger an alert.
- **Loop detection:** Repeated identical jobs within a short window are flagged as potential loops.

Argus runs in active blocking mode by default (`OBSERVATION_MODE=false`). In observation mode
it logs issues without blocking -- this is available for testing but should not be used in
production.

## canUseTool Interceptor

Every MCP (Model Context Protocol) tool call made by a task agent passes through a
`canUseTool` interceptor in the conductor before it is dispatched.

The interceptor checks the tool name against a per-agent allowlist:

| Agent | Allowed tools |
|-------|---------------|
| Mail agent | Email send, email read, email search |
| Calendar agent | Calendar read, calendar write, event create |
| Files agent | SharePoint/Drive read, SharePoint/Drive write |
| Voice agent | TTS synthesis only |

If a mail agent attempts to call a files tool, the call is blocked, the attempt is logged to
the audit trail, and an alert is generated. This prevents a compromised or misbehaving agent
from accessing data outside its defined scope.

## Message Integrity Checks

Conductors validate inbound messages before routing them to the job queue. The validation
layer checks for known patterns associated with:

- Instruction override attempts (attempts to modify system behaviour via user message)
- Direct credential requests (messages that ask the agent to reveal keys or tokens)
- Obfuscated commands (encoded or fragmented instructions designed to evade pattern matching)

On detection: the message is dropped, the attempt is logged with full context, and an alert
is sent to the operator. The job is never written to the queue.

## Watchdog

The admin watchdog runs twice daily (08:00 and 20:00). It:

1. Reads a baseline file containing SHA-256 hashes of key system files (conductor scripts,
   plist files, Argus script, configuration files)
2. Recomputes hashes of all tracked files
3. Reports any file that does not match its baseline hash

The watchdog does not auto-remediate -- it alerts only. The baseline is recomputed after every
legitimate deploy using the rebaseline script.

## Credential Model

| Component | Credentials held |
|-----------|-----------------|
| Admin agent | Admin credentials only (OS-level) |
| Argus | None |
| Conductors | None |
| Mail agent | Mail OAuth token for its company only |
| Calendar agent | Calendar OAuth token for its company only |
| Files agent | Files OAuth token for its company only |
| Voice agent | TTS API key for its company only |
| Personal AI | Cross-company read tokens + operator API keys (by design) |

No conductor holds credentials. This means a compromised conductor cannot directly access
any external service -- it can only write jobs to the queue, which Argus must approve.

## Audit Trail

All security-relevant events are logged:

- **Job queue:** Every job state transition (pending, approved, blocked, complete, failed) is
  recorded in `jobs.db` with timestamps.
- **Argus rejections:** Each blocked job includes the rejection reason stored in the job record.
- **canUseTool violations:** Logged to the conductor log file with agent ID, tool name, and
  timestamp.
- **Message integrity rejections:** Logged to the conductor log with the message hash and
  pattern that triggered the check.
