# =============================================================================
# stub-helpers.sh -- Shared helpers for the 7 STUB modules that wire credentials
# but depend on the v0.5 multi-tenant conductor runtime (not yet shipped).
#
# Sourced by each stub module's install.sh BEFORE the install steps run.
# When the v0.5 conductor lands, these helpers update in one place: replace
# stub_scaffolded_warning with a no-op and stub_check_conductor with a real
# precondition check.
# =============================================================================

# Print a standardised "scaffolded -- conductor runtime ships in v0.5.x"
# warning. Called at the start of install.sh AND repeated at the end (twice
# because operators may scroll past the start prompt and only see the tail).
#
# Usage: stub_scaffolded_warning "module-name"
stub_scaffolded_warning() {
  local mod="$1"
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────────┐"
  echo "  │  NOTE: $mod is a SCAFFOLDED module"
  echo "  │"
  echo "  │  This installer wires the credentials your conductor will read,"
  echo "  │  but the conductor runtime that consumes them ships in v0.5.x"
  echo "  │  (not in v0.4). Install reports PASS once credentials are saved;"
  echo "  │  the agent surface goes live when v0.5.x is installed."
  echo "  │"
  echo "  │  See CHANGELOG.md for v0.5.x release status."
  echo "  └─────────────────────────────────────────────────────────────────┘"
  echo ""
}

# Check if the per-tenant conductor runtime is installed for this company.
# Returns 0 if conductor present (v0.5.x or later), 1 if absent (v0.4.x stub).
#
# Usage: if stub_check_conductor "company-a"; then RUN_AUTH; else SKIP; fi
stub_check_conductor() {
  local slug="$1"
  [[ -f "$INSTALL_PATH/$slug-conductor/pbox-conductor.mjs" ]] && return 0
  [[ -d "$INSTALL_PATH/$slug/node_modules/@anthropic-ai" ]] && return 0
  return 1
}

# Validate that a company slug refers to an installed company. Lists candidate
# slugs if the supplied one isn't valid, then refuses.
#
# Usage: stub_validate_slug "company-a"  (exits 1 with helpful message if invalid)
stub_validate_slug() {
  local slug="$1"
  local base="$INSTALL_PATH/$slug"
  if [[ -d "$base" && -f "$base/.env" ]]; then
    return 0
  fi
  echo ""
  echo "  ERROR: '$slug' is not an installed company."
  echo "  Installed companies (with .env files):"
  local found=0
  for d in "$INSTALL_PATH"/*/; do
    local name=$(basename "$d")
    case "$name" in
      argus|muse|scripts|certs|secrets|assets|store|logs|*-conductor|*-mail|*-calendar|*-files|*-voice) continue ;;
    esac
    if [[ -f "$d/.env" ]]; then
      echo "    - $name"
      found=1
    fi
  done
  [[ "$found" == "0" ]] && echo "    (none -- run setup-company.sh in pbox-setup.sh first)"
  return 1
}

# Idempotent .env key writer. Removes any existing key=value line for $key,
# then appends the new value. Always uses chmod 600.
#
# Usage: stub_env_set "$ENV_FILE" "KEY" "value"
stub_env_set() {
  local env_file="$1"
  local key="$2"
  local val="$3"
  sudo sed -i'' "/^${key}=/d" "$env_file"
  sudo bash -c "echo '${key}=${val}' >> '$env_file'"
  sudo chmod 600 "$env_file"
}

# Standardised prerequisite check: Node 18+ on PATH.
# Usage: stub_check_node  (exits 1 with helpful message if missing)
stub_check_node() {
  if ! command -v node &>/dev/null; then
    echo "  ERROR: Node.js not found on PATH."
    echo "  Install via Homebrew: brew install node"
    return 1
  fi
  local ver=$(node --version | tr -d 'v' | cut -d. -f1)
  if [[ "$ver" -lt 18 ]]; then
    echo "  ERROR: Node.js $ver found, but 18+ required."
    return 1
  fi
  return 0
}
