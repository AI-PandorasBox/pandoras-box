#!/usr/bin/env bash
# youtube-publishing module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
echo "[youtube-publishing] installing runtime to ${PBOX_HOME}/shared/modules/youtube-publishing"
install -d "${PBOX_HOME}/shared/modules/youtube-publishing"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/youtube-publishing/" 2>/dev/null || true
echo "[youtube-publishing] done. Enable in the activation matrix to use."
