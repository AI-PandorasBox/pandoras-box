# =============================================================================
# setup-unattended.sh -- real unattended install (PBOX_UNATTENDED=1).
#
# Unlike PBOX_DRY_RUN (which sandboxes INSTALL_PATH and shims sudo/launchctl/npm
# so NOTHING real happens), PBOX_UNATTENDED runs the REAL install but auto-answers
# every prompt from its default. Optional integrations (prompt_yes_no) default to
# "no" and are skipped; required fields (prompt_required) get a placeholder so the
# install completes with dummy/absent credentials.
#
# Use case: building the Hades base-master-mirror test snapshot, CI installs, and
# any headless deployment. NO action shims are installed -- real dirs/users/services.
#
#   PBOX_UNATTENDED=1 bash pbox-setup.sh
#   PBOX_UNATTENDED_TIER=2          # default 1 (Personal)
#   PBOX_UNATTENDED_FORCE_ALL=1     # flip optional modules to "yes"
#   PBOX_UNATTENDED_PLACEHOLDER=... # value for required prompts (default 'unattended-placeholder')
# =============================================================================

# Only active when explicitly unattended AND not dry-run (dry-run takes precedence).
if [[ "${PBOX_UNATTENDED:-0}" != "1" || "${PBOX_DRY_RUN:-0}" == "1" ]]; then
  return 0 2>/dev/null || true
fi

PBOX_UNATTENDED_ACTIVE=1
export PBOX_UNATTENDED_ACTIVE
# Headless runs have no TERM -> tput aborts under set -e. Provide a safe default.
export TERM="${TERM:-dumb}"

echo "" >&2
echo "  ╔═══════════════════════════════════════════════════════════╗" >&2
echo "  ║  PBOX_UNATTENDED=1 ACTIVE -- real install, no prompts     ║" >&2
echo "  ║  Optional integrations skipped; required fields placeheld ║" >&2
echo "  ╚═══════════════════════════════════════════════════════════╝" >&2

# Prompt overrides -- same shape as the dry-run ones, installed AFTER setup-core.sh.
pbox_install_unattended_prompt_overrides() {
  prompt_yes_no() {
    local question="$1" var_name="$2" default="${3:-no}"
    [[ "${PBOX_UNATTENDED_FORCE_ALL:-0}" == "1" ]] && default="yes"
    eval "$var_name=\"$default\""
  }
  prompt_with_default() {
    local question="$1" default="$2" var_name="$3"
    eval "$var_name=\"$default\""
  }
  prompt_required() {
    local question="$1" var_name="$2"
    eval "$var_name=\"${PBOX_UNATTENDED_PLACEHOLDER:-unattended-placeholder}\""
  }
  press_enter_to_continue() { :; }
}
export -f pbox_install_unattended_prompt_overrides
