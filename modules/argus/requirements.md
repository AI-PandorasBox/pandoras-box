# argus requirements

- **Node 22+** (built-in `node:sqlite`).
- **content-classifier** module installed + running (Argus scores prompts through it).
- Read/write access to each tenant's `<install>/<tenant>/store/jobs.db`
  (Argus runs as a service account with that access).
- For gating to engage, the conductor must keep jobs in `PENDING_REVIEW`
  (`CONTENT_CLASSIFIER_INSTALLED=true` in the conductor env).

No third-party accounts or network egress. Cost: free (local).
