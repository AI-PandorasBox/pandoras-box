#!/usr/bin/env bash
# writing-toolkit module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
echo "[writing-toolkit] installing runtime to ${PBOX_HOME}/shared/modules/writing-toolkit"
install -d "${PBOX_HOME}/shared/modules/writing-toolkit"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/writing-toolkit/" 2>/dev/null || true
echo "[writing-toolkit] done. Enable in the activation matrix to use."
