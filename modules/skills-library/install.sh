#!/usr/bin/env bash
# install.sh -- skills-library module installer
# Copies tenant-agnostic skill primitives into $INSTALL_PATH/shared/skills/library/.
# Idempotent: refreshes skill code, never overwrites operator-specific presets/.
set -euo pipefail

MODULE_NAME="skills-library"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

# Source of skills: prefer staged install tree, fall back to the cloned repo.
SRC_DIR="$INSTALL_PATH/modules/$MODULE_NAME/skills"
[[ -d "$SRC_DIR" ]] || SRC_DIR="${SETUP_DIR:-$INSTALL_PATH}/modules/$MODULE_NAME/skills"
TARGET_DIR="$INSTALL_PATH/shared/skills/library"

step 1 "Prerequisites (Node)"
command -v node &>/dev/null || fail "node not found (the personal-ai module installs the Node runtime)"
[[ -d "$SRC_DIR" ]] || fail "skills source not found at $SRC_DIR"
ok "node $(node --version), source $SRC_DIR"

step 2 "Staging skills -> $TARGET_DIR"
sudo mkdir -p "$TARGET_DIR"
for skill_dir in "$SRC_DIR"/*/; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  dest="$TARGET_DIR/$name"
  sudo mkdir -p "$dest"
  # Refresh skill code + manifest; never touch an existing presets/ dir (operator data).
  for f in "$skill_dir"*.mjs "$skill_dir"SKILL.md; do
    [[ -f "$f" ]] && sudo cp "$f" "$dest/"
  done
  [[ -d "$dest/presets" ]] || sudo mkdir -p "$dest/presets"
  ok "installed skill: $name"
done

step 3 "Syntax check installed skills"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) skipping node --check"
else
  rc=0
  while IFS= read -r mjs; do
    node --check "$mjs" || { echo "  syntax FAIL: $mjs"; rc=1; }
  done < <(find "$TARGET_DIR" -name '*.mjs' -type f)
  [[ $rc -eq 0 ]] && ok "all skill .mjs pass node --check" || fail "a skill failed node --check"
fi

step 4 "Done"
ok "skills library installed at $TARGET_DIR"
echo "[$MODULE_NAME] Skills are tenant-agnostic. Add per-company branding presets under <skill>/presets/."
