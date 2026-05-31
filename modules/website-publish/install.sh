#!/usr/bin/env bash
# website-publish module installer
set -euo pipefail
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBOX_HOME="${PBOX_HOME:-/opt/pandoras-box}"
echo "[website-publish] installing runtime to ${PBOX_HOME}/shared/modules/website-publish"
install -d "${PBOX_HOME}/shared/modules/website-publish"
cp -f "${MODULE_DIR}/runtime/"*.mjs "${PBOX_HOME}/shared/modules/website-publish/" 2>/dev/null || true
echo "[website-publish] done. Enable in the activation matrix to use."
