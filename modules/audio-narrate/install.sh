#!/usr/bin/env bash
# audio-narrate module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
echo "[audio-narrate] installing runtime to ${PBOX_HOME}/shared/modules/audio-narrate"
install -d "${PBOX_HOME}/shared/modules/audio-narrate"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/audio-narrate/" 2>/dev/null || true
echo "[audio-narrate] done. Enable in the activation matrix to use."
