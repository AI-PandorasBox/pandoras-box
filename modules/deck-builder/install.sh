#!/usr/bin/env bash
# install.sh -- deck-builder. Installs python-pptx + puts `pbox-deck` on PATH.
set -euo pipefail
MODULE_NAME="deck-builder"
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime/render.py"

echo "[$MODULE_NAME] step 1/3: Python prerequisites"
command -v python3 &>/dev/null || { echo "[$MODULE_NAME] FAIL: python3 not found"; exit 1; }
echo "[$MODULE_NAME] OK: $(python3 --version)"

echo "[$MODULE_NAME] step 2/3: Installing python-pptx"
if [[ "${PBOX_DRY_RUN_ACTIVE:-${PBOX_DRY_RUN:-0}}" == "1" ]]; then
  echo "[$MODULE_NAME] OK: (dry-run) would pip3 install python-pptx"
elif python3 -c "import pptx" 2>/dev/null; then
  echo "[$MODULE_NAME] OK: python-pptx already present"
else
  python3 -m pip install --user python-pptx >/dev/null 2>&1 \
    && echo "[$MODULE_NAME] OK: python-pptx installed" \
    || echo "[$MODULE_NAME] WARN: pip install python-pptx failed; run it manually"
fi

echo "[$MODULE_NAME] step 3/3: pbox-deck on PATH"
[[ -f "$SRC" ]] || { echo "[$MODULE_NAME] FAIL: render.py missing"; exit 1; }
chmod +x "$SRC" 2>/dev/null || true
TARGET_SRC="$INSTALL_PATH/deck-builder/runtime/render.py"
[[ -f "$TARGET_SRC" ]] || TARGET_SRC="$SRC"
if sudo ln -sf "$TARGET_SRC" /usr/local/bin/pbox-deck 2>/dev/null; then
  echo "[$MODULE_NAME] OK: pbox-deck on PATH"
else
  echo "[$MODULE_NAME] (note) run directly: python3 $TARGET_SRC --spec deck.json --out deck.pptx"
fi
echo "[$MODULE_NAME] PASS"
