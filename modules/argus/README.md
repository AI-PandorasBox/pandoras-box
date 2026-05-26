# argus — the Security Overseer

Argus is the oversight daemon. It is the layer that turns a *pending* job into an
*approved* or *rejected* one: it watches every tenant's job queue, scores each
job's prompt through the **content-classifier**, and flips the row accordingly.
Repeat offenders are quarantined, and it runs a weekly dependency scan.

## What it does

- **Reviews jobs.** Every ~60s it scans `<install>/<tenant>/store/jobs.db` for
  rows in `PENDING_REVIEW`, scores the prompt via the content-classifier
  (`/api/score`), and sets the row to `APPROVED` or `REJECTED`, recording a
  `job_events` entry (`actor: argus`).
- **Quarantines.** A source that accrues `ARGUS_STRIKE_LIMIT` (default 3) blocks
  is quarantined — its further jobs are set `BLOCKED` outright.
- **Fails closed.** If the classifier is unreachable, jobs stay `PENDING_REVIEW`
  (nothing is approved unseen). Set `ARGUS_FAIL_OPEN=true` to change that
  (not recommended).
- **Weekly dependency scan.** Runs `npm audit` over the install once a week and
  writes `store/pending-mitigations.json`.
- Everything is logged to `store/argus-audit.log`.

## Install

```bash
bash modules/argus/install.sh
```

Requires the **content-classifier** module. For Argus to actually gate jobs, the
conductor must keep jobs in `PENDING_REVIEW` for review rather than
auto-approving — set `CONTENT_CLASSIFIER_INSTALLED=true` in the conductor's
environment and restart it (the installer prints a reminder).

## Config (env)

| var | default | meaning |
|-----|---------|---------|
| `ARGUS_POLL_SEC` | 60 | review interval |
| `CONTENT_CLASSIFIER_URL` | http://127.0.0.1:8487 | scoring service |
| `ARGUS_STRIKE_LIMIT` | 3 | blocks before a source is quarantined |
| `ARGUS_FAIL_OPEN` | false | approve when the classifier is down |
