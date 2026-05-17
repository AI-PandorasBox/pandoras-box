# content-classifier

> **Content Safety Classifier**

**Status:** Optional (recommended)
**Depends on:** core, Python 3.11+, ~600 MB disk

## What It Does

Lightweight 0.3B-parameter classifier that scores outbound text across six
axes before it leaves the system:

1. Prompt safety
2. Response safety
3. Response refusal (over-refusal detection)
4. Prompt toxicity
5. Response toxicity
6. Jailbreak detection

Runs locally on CPU using a HuggingFace-hosted GLiGuard-style model.
**Shadow mode by default** — observes for the calibration window (default
4 weeks) before any blocking. You can see exactly what it would have
caught before it actually catches anything.

## How To Access

There is no UI. the Content Classifier runs as a sidecar daemon and is consulted by
the Oversight Daemon for every outbound action. View its decisions in
the audit log:

```
tail -f /tmp/pandoras-box-content-classifier.log
```

Or via the Dashboard "Content Classifier" panel (if `dashboard` is installed).

## Fail Mode

During install you'll be asked: when the Content Classifier is offline or fails, should
outbound content:

- **Fail-open** (default for low-tenancy installs) — content still ships
- **Fail-closed** (default for service-provider installs) — content is held until the Content Classifier recovers

Both modes are revisitable: edit `/opt/pandoras-box/content-classifier/.env` and
restart the service.

## Monthly Cost

None. Local CPU inference.

## Uninstall

```
sudo launchctl stop com.pandoras-box.content-classifier
sudo launchctl unload ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.content-classifier.plist
sudo rm ${PBOX_PLIST_DIR:-/Library/LaunchDaemons}/com.pandoras-box.content-classifier.plist
sudo rm -rf /opt/pandoras-box/content-classifier
```
