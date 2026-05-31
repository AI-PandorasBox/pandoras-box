#!/usr/bin/env bash
# marketing module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
echo "[marketing] installing runtime to ${PBOX_HOME}/shared/modules/marketing"
install -d "${PBOX_HOME}/shared/modules/marketing"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/marketing/" 2>/dev/null || true
echo "[marketing] done. Enable in the activation matrix to use."
