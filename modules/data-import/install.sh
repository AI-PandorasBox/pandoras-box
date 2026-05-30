#!/usr/bin/env bash
# data-import installer. Puts `pbox-import` on PATH. Idempotent. No daemon.
set -euo pipefail
NAME="data-import"
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime/pbox-import.mjs"

[[ -f "$SRC" ]] || { echo "[$NAME] FAIL: runtime/pbox-import.mjs missing"; exit 1; }
chmod +x "$SRC" 2>/dev/null || true

# Prefer the staged install copy if present, else this repo copy.
TARGET_SRC="$INSTALL_PATH/data-import/runtime/pbox-import.mjs"
[[ -f "$TARGET_SRC" ]] || TARGET_SRC="$SRC"

if sudo ln -sf "$TARGET_SRC" /usr/local/bin/pbox-import 2>/dev/null; then
  echo "[$NAME] pbox-import is on your PATH"
else
  echo "[$NAME] (note) could not symlink to /usr/local/bin; run it directly: node $TARGET_SRC"
fi

echo "[$NAME] PASS"
