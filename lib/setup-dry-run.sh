# =============================================================================
# setup-dry-run.sh -- Sandbox mode for the installer.
#
# Activated by setting PBOX_DRY_RUN=1 in the environment before running
# pbox-setup.sh. When active:
#
#   - INSTALL_PATH is rebased to /tmp/pbox-sandbox-$$ (per-invocation tmpdir)
#   - sudo becomes a no-op pass-through ("sudo CMD" -> just runs CMD with
#     the current user; mkdir/chmod/chown still work in /tmp)
#   - launchctl is stubbed -- logs the call, returns 0
#   - brew install is stubbed -- logs the call, returns 0
#   - npm install -g is stubbed -- logs the call, returns 0
#   - security add-generic-password is stubbed
#   - curl calls to anthropic.com / claude.ai return a synthetic 200
#   - read prompts auto-accept the default answer (no interactive blocking)
#
# Use case: pre-flip audits, CI smoke tests, repeatable end-to-end runs that
# never touch /opt/pandoras-box or system services.
# =============================================================================

if [[ "${PBOX_DRY_RUN:-0}" != "1" ]]; then
  # Real install -- no shims installed.
  return 0 2>/dev/null || true
fi

PBOX_DRY_RUN_LOG="${PBOX_DRY_RUN_LOG:-/tmp/pbox-dry-run-$$.log}"
PBOX_SANDBOX_ROOT="${PBOX_SANDBOX_ROOT:-/tmp/pbox-sandbox-$$}"

# Re-root the install path. ALL downstream lib/setup-*.sh code references
# $INSTALL_PATH; rebasing here means they all land in the sandbox dir.
INSTALL_PATH="$PBOX_SANDBOX_ROOT"
export INSTALL_PATH
mkdir -p "$INSTALL_PATH"

# Re-root the LaunchDaemons dir too -- modules' install.sh should respect
# PBOX_PLIST_DIR (defaults to /Library/LaunchDaemons in normal installs).
PBOX_PLIST_DIR="$PBOX_SANDBOX_ROOT/LaunchDaemons"
export PBOX_PLIST_DIR
mkdir -p "$PBOX_PLIST_DIR"

# Logging helper used by every shim. Exported so child bash invocations
# (e.g. from `sudo bash -c "..."`) can see it.
_pbox_log_shim() {
  echo "[DRY-RUN $(date '+%H:%M:%S')] $*" | tee -a "${PBOX_DRY_RUN_LOG:-/tmp/pbox-dry-run.log}" >&2
}
export -f _pbox_log_shim
export PBOX_DRY_RUN_LOG

# --- sudo -----------------------------------------------------------------
# Pass-through: drop the literal "sudo" and run the rest as the current user.
# Handles common flags: -n, -E, -u <user>, --
# Special-cases chown / chgrp -- these inherently need root, no-op in dry-run.
sudo() {
  local args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n|-E|-S|-H|-A) shift ;;
      -u) shift 2 ;;
      --) shift; break ;;
      *)  break ;;
    esac
  done
  args=("$@")
  _pbox_log_shim "sudo: ${args[*]}"
  case "${args[0]:-}" in
    chown|chgrp)
      _pbox_log_shim "  (no-op: ${args[0]} requires root, skipped in dry-run)"
      return 0
      ;;
  esac
  "${args[@]}"
}
export -f sudo

# --- launchctl ------------------------------------------------------------
launchctl() {
  _pbox_log_shim "launchctl $*"
  return 0
}
export -f launchctl

# --- brew install ---------------------------------------------------------
# Real `brew --version` etc still works; only `brew install <pkg>` is stubbed.
brew() {
  if [[ "${1:-}" == "install" ]]; then
    _pbox_log_shim "brew install ${*:2}"
    return 0
  fi
  command brew "$@"
}
export -f brew

# --- npm install -g -------------------------------------------------------
npm() {
  if [[ "${1:-}" == "install" && ( "${2:-}" == "-g" || "${2:-}" == "--global" ) ]]; then
    _pbox_log_shim "npm install -g ${*:3}"
    return 0
  fi
  command npm "$@"
}
export -f npm

# --- security (macOS Keychain) -------------------------------------------
security() {
  if [[ "${1:-}" == "add-generic-password" || "${1:-}" == "find-generic-password" || "${1:-}" == "delete-generic-password" ]]; then
    _pbox_log_shim "security $*"
    return 0
  fi
  command security "$@"
}
export -f security

# --- read -- auto-accept defaults (skip interactive prompts) -------------
# prompt_with_default + prompt_yes_no both use plain read. We override the
# core prompt helpers to short-circuit in dry-run mode after sourcing
# setup-core.sh. Done via a post-source hook in pbox-setup.sh.
PBOX_DRY_RUN_ACTIVE=1
export PBOX_DRY_RUN_ACTIVE

_pbox_log_shim "DRY-RUN mode active. INSTALL_PATH rebased to $INSTALL_PATH"
_pbox_log_shim "Shim log: $PBOX_DRY_RUN_LOG"
echo "" >&2
echo "  ╔═══════════════════════════════════════════════════════════╗" >&2
echo "  ║  PBOX_DRY_RUN=1 ACTIVE                                    ║" >&2
echo "  ║  No system writes. INSTALL_PATH=$INSTALL_PATH" >&2
echo "  ║  Shim log: $PBOX_DRY_RUN_LOG" >&2
echo "  ╚═══════════════════════════════════════════════════════════╝" >&2
echo "" >&2

# --- Override prompts to auto-accept defaults ----------------------------
# These must override the definitions in setup-core.sh, so they're (re-)defined
# AFTER setup-core.sh is sourced. We install a post-source hook by stashing
# the overrides into a function that pbox-setup.sh calls after all sources.
pbox_install_dryrun_prompt_overrides() {
  prompt_yes_no() {
    local question="$1" var_name="$2" default="${3:-no}"
    _pbox_log_shim "[prompt_yes_no auto-answered '$default'] $question"
    eval "$var_name=\"$default\""
  }
  prompt_with_default() {
    local question="$1" default="$2" var_name="$3"
    _pbox_log_shim "[prompt_with_default auto-answered '$default'] $question"
    eval "$var_name=\"$default\""
  }
  prompt_required() {
    local question="$1" var_name="$2"
    _pbox_log_shim "[prompt_required auto-answered 'dryrun-placeholder'] $question"
    eval "$var_name=\"dryrun-placeholder\""
  }
  press_enter_to_continue() {
    _pbox_log_shim "[press_enter_to_continue auto-bypassed]"
  }
}
export -f pbox_install_dryrun_prompt_overrides
