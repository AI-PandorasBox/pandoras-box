#!/usr/bin/env bash
# install.sh -- skill-governance module installer (library; no daemon).
# Stages the runtime into the shared modules dir where consumers import it (e.g. the
# fleet skill-sync verifier). Generates the local signing keypair if absent. node-checks.
set -euo pipefail

MODULE_NAME="skill-governance"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

MODULE_SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/runtime"
TARGET_DIR="$INSTALL_PATH/shared/modules/$MODULE_NAME"
KEY_DIR="${PBOX_SKILL_KEY_DIR:-$INSTALL_PATH/shared/skill-signing}"

step 1 "Prerequisites (Node.js)"
command -v node &>/dev/null || fail "node not found"
ok "node $(node --version)"

step 2 "Staging runtime"
sudo mkdir -p "$TARGET_DIR"
sudo cp "$MODULE_SRC_DIR/skill-governance.mjs" "$TARGET_DIR/"
node --check "$TARGET_DIR/skill-governance.mjs" || fail "skill-governance.mjs failed node --check"
ok "Staged $TARGET_DIR/skill-governance.mjs"

step 3 "Signing key (generated locally, kept OFF any repo)"
sudo mkdir -p "$KEY_DIR"
if [[ -f "$KEY_DIR/pbox-skill-signing.key" ]]; then
  ok "Signing key already present -- left untouched"
else
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    ok "(dry-run) would generate signing keypair at $KEY_DIR"
  else
    PBOX_SKILL_KEY_DIR="$KEY_DIR" sudo -E node "$TARGET_DIR/skill-governance.mjs" keygen || fail "keygen failed"
    sudo chmod 600 "$KEY_DIR/pbox-skill-signing.key" 2>/dev/null || true
    ok "Signing keypair generated at $KEY_DIR (private key mode 600, never committed)"
  fi
fi

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Library: $TARGET_DIR/skill-governance.mjs"
echo "  CLI: node $TARGET_DIR/skill-governance.mjs {scan|sign|verify|card|gate} <skillDir>"
echo "  Keys: $KEY_DIR (private key off-repo, mode 600)"
exit 0
