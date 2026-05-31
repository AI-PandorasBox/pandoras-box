#!/usr/bin/env bash
# visual-plan module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
echo "[visual-plan] installing runtime to ${PBOX_HOME}/shared/modules/visual-plan"
install -d "${PBOX_HOME}/shared/modules/visual-plan"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/visual-plan/" 2>/dev/null || true
echo "[visual-plan] done. Enable in the activation matrix to use."
