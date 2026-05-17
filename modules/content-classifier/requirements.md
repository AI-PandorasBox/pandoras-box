# content-classifier requirements

| Requirement | Detail |
|-------------|--------|
| Python | 3.11 or later (installer checks; install with `brew install python@3.11`) |
| Disk | ~600 MB for the classifier model (auto-downloaded on first run) |
| RAM | 1 GB headroom (model loaded once per service start) |
| Network | One-time download of model weights from HuggingFace |
| Port | 8487 (localhost only — internal sidecar, no external exposure) |
| Permissions | Reads outbound queue, writes audit-log entries; no other system access |
