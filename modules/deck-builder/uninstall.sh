#!/usr/bin/env bash
set -euo pipefail
sudo rm -f /usr/local/bin/pbox-deck 2>/dev/null || true
echo "[deck-builder] removed pbox-deck (python-pptx left installed)"
