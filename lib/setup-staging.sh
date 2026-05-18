# =============================================================================
# setup-staging.sh -- Copy the cloned-repo tree to $INSTALL_PATH.
#
# Every module install.sh and every post-install helper expects to find its
# siblings under /opt/pandoras-box/ (lib/, scripts/, modules/, config/,
# assets/, manuals/, docs/). Without staging, those references 404.
#
# Idempotent: only copies files that are missing or out-of-date.
# =============================================================================

# Sub-trees we copy from the cloned-repo SETUP_DIR to INSTALL_PATH.
# Anything NOT in this list stays out of /opt/pandoras-box/.
_STAGE_DIRS=( lib scripts modules config assets manuals docs hooks )
_STAGE_FILES=( README.md CHANGELOG.md DISCLAIMER.md LICENSE VERSION )

run_staging() {
  section_header "Staging installer files to $INSTALL_PATH"
  echo "  Copying lib/, scripts/, modules/, config/, assets/, manuals/, docs/, hooks/"
  echo "  from the cloned repo into $INSTALL_PATH so module installers and"
  echo "  post-install helpers can find their siblings."
  echo ""

  sudo mkdir -p "$INSTALL_PATH"

  # Establish the VERSION anchor used by `pbox update --check-only` (Layer 1
  # of the auto-update mechanism). Three sources, in order of trust:
  #   1) $SETUP_DIR/VERSION already exists (release tarball ships one)
  #   2) git describe in $SETUP_DIR (clone-from-source operators)
  #   3) "v0.0.0-dev" fallback so the file always exists
  if [[ ! -f "$SETUP_DIR/VERSION" ]]; then
    local detected
    if detected=$(cd "$SETUP_DIR" 2>/dev/null && git describe --tags --abbrev=0 2>/dev/null); then
      echo "$detected" > "$SETUP_DIR/VERSION"
    else
      echo "v0.0.0-dev" > "$SETUP_DIR/VERSION"
    fi
  fi

  local copied=0 skipped=0 dirs_done=0
  for sub in "${_STAGE_DIRS[@]}"; do
    local src="$SETUP_DIR/$sub"
    if [[ ! -d "$src" ]]; then
      info_msg "  skip (not in cloned repo): $sub/"
      continue
    fi
    # rsync gives us idempotent + size/mtime-aware copy. Excludes .bak files +
    # node_modules + .git so we don't pollute INSTALL_PATH.
    sudo rsync -a \
      --exclude '*.bak-*' \
      --exclude '.bak-*' \
      --exclude 'node_modules' \
      --exclude '.git' \
      "$src/" "$INSTALL_PATH/$sub/"
    check_pass "staged: $sub/"
    dirs_done=$((dirs_done+1))
  done

  for f in "${_STAGE_FILES[@]}"; do
    local src="$SETUP_DIR/$f"
    if [[ -f "$src" ]]; then
      sudo cp -p "$src" "$INSTALL_PATH/$f"
      copied=$((copied+1))
    else
      skipped=$((skipped+1))
    fi
  done

  # Permissions: lib + scripts + modules executable; everything readable.
  sudo find "$INSTALL_PATH/lib" "$INSTALL_PATH/scripts" "$INSTALL_PATH/modules" \
       -name '*.sh' -exec chmod +x {} \; 2>/dev/null || true

  success_msg "Staged $dirs_done directories + $copied top-level files."
  echo ""
}
