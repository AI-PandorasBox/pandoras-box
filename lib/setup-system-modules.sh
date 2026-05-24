# =============================================================================
# setup-system-modules.sh -- Bridge functions for system-side modules.
#
# These are the run_X_setup wrappers that the modules picker (setup-modules.sh)
# calls when an operator chooses to install one of the system/admin modules.
# Each function:
#   1. Logs intent
#   2. Delegates to the module's own install.sh (lives at
#      $INSTALL_PATH/modules/<name>/install.sh after staging)
#   3. Reports outcome via check_pass / warn_msg
#
# By centralising the bridges, we kill the previous "type X &>/dev/null && X"
# silent-skip pattern that let modules be selected in the menu but never
# actually run. Now: if a bridge is missing, the install errors loudly.
# =============================================================================

# Internal helper. Runs <install_path>/modules/<name>/install.sh under sudo,
# captures rc, prints check_pass on success or warn_msg on failure.
_run_module_install() {
  local name="$1"
  local script="$INSTALL_PATH/modules/$name/install.sh"
  if [[ ! -x "$script" ]]; then
    # Fallback to SETUP_DIR (cloned repo) if staging hasn't happened yet.
    script="$SETUP_DIR/modules/$name/install.sh"
  fi
  if [[ ! -f "$script" ]]; then
    error_msg "module '$name' install.sh not found at $INSTALL_PATH/modules/$name/ or $SETUP_DIR/modules/$name/"
    return 1
  fi
  echo ""
  info_msg "Running module installer: $name"
  if sudo bash "$script"; then
    check_pass "module '$name' install completed"
    return 0
  else
    warn_msg "module '$name' install reported a non-zero exit code (see output above)"
    return 1
  fi
}

run_ollama_setup()      { _run_module_install ollama; }
run_dashboard_setup()   { _run_module_install dashboard; }
run_terminal_setup()    { _run_module_install terminal; }
run_admin_lite_setup()  { _run_module_install admin-lite; }
run_admin_shell_setup() { _run_module_install admin-shell; }
run_self_improvement_setup()      { _run_module_install self-improvement; }
run_content_classifier_setup()    { _run_module_install content-classifier; }
run_docs_server_setup() { _run_module_install docs-server; }
run_skills_library_setup() { _run_module_install skills-library; }
