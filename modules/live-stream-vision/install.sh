#!/usr/bin/env bash
# live-stream-vision module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
source "${PBOX_HOME}/lib/os-compat.sh" 2>/dev/null || true

echo "[live-stream-vision] installing runtime to ${PBOX_HOME}/shared/modules/live-stream-vision"
install -d "${PBOX_HOME}/shared/modules/live-stream-vision"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/live-stream-vision/" 2>/dev/null || true

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "[live-stream-vision] note: GEMINI_API_KEY not set - module installed but inert until configured."
fi

echo "[live-stream-vision] done. Enable in the activation matrix (requires personal-ai) to start."
