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
    warn_msg "module '$name' install.sh not found (looked in $INSTALL_PATH/modules/$name/ and $SETUP_DIR/modules/$name/)"
    info_msg "Skipping '$name' -- install continues."
    return 0
  fi
  echo ""
  info_msg "Running module installer: $name"
  if sudo bash "$script"; then
    check_pass "module '$name' install completed"
    return 0
  fi
  # Module failed. THIS IS NOT FATAL: optional modules are independent and the
  # rest of the install carries on. Offer a Claude-assisted diagnosis.
  warn_msg "module '$name' did not complete -- the rest of the install continues."
  info_msg "You can re-run just this module later: sudo bash $script"
  if declare -F pbox_claude_help >/dev/null 2>&1; then
    pbox_claude_help "module '$name' install failed"
  fi
  return 0
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

# _CORE_FROM_REGISTRY_2026-05-30 -- install EVERY module tagged tier=core in
# modules/registry.json, unconditionally. Previously the core set was scattered
# through the optional picker: dashboard/docs/classifier/self-improvement were
# [RECOMMENDED] (installed) but terminal/admin-lite/offline-kb/skills-library were
# [OPTIONAL] (skipped in unattended) and argus had no entry at all -> a default
# install came up hollow. This makes the registry the single source of truth.
# personal-ai is skipped here -- it has its own dedicated step (passphrase).
run_core_modules() {
  section_header "Core modules"
  local reg="$INSTALL_PATH/modules/registry.json"
  [[ -f "$reg" ]] || reg="${SETUP_DIR:-.}/modules/registry.json"
  local node_bin; node_bin=$(command -v node || echo node)
  local core_list=""
  [[ -f "$reg" ]] && core_list=$("$node_bin" -e "try{const r=require('$reg');process.stdout.write(r.modules.filter(m=>m.tier==='core'&&m.name!=='personal-ai').map(m=>m.name).join(' '))}catch(e){}" 2>/dev/null)
  [[ -z "$core_list" ]] && core_list="dashboard docs-server content-classifier self-improvement skills-library argus admin-lite terminal offline-kb"
  info_msg "Core modules (from registry): $core_list"
  for m in $core_list; do
    # idempotent: skip if the service unit is already installed (the optional
    # picker may also reference some of these).
    if command -v systemctl &>/dev/null && systemctl list-unit-files "pbox-${m}.service" 2>/dev/null | grep -q "pbox-${m}.service"; then
      check_pass "core module '$m' already installed"
      continue
    fi
    _run_module_install "$m"
  done
}
