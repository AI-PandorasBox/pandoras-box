# _A6_1B_TIER_LABELS_V1
# =============================================================================
# setup-core.sh -- Core utility functions for the Pandoras Box installer
# Sourced by pbox-setup.sh
# =============================================================================

# Colour codes
C_RESET="\033[0m"
C_GREEN="\033[0;32m"
C_RED="\033[0;31m"
C_YELLOW="\033[1;33m"
C_CYAN="\033[0;36m"
C_BOLD="\033[1m"
C_DIM="\033[2m"

check_pass()   { echo -e "  ${C_GREEN}[PASS]${C_RESET} $*"; }
check_fail()   { echo -e "  ${C_RED}[FAIL]${C_RESET} $*"; }
success_msg()  { echo -e "  ${C_GREEN}${C_BOLD}$*${C_RESET}"; }
error_msg()    { echo -e "  ${C_RED}${C_BOLD}ERROR: $*${C_RESET}"; }
warn_msg()     { echo -e "  ${C_YELLOW}WARNING: $*${C_RESET}"; }
info_msg()     { echo -e "  ${C_CYAN}$*${C_RESET}"; }
section_header() { echo -e "\n  ${C_BOLD}${C_CYAN}=== $* ===${C_RESET}\n"; }

error_exit() {
  echo ""
  error_msg "$*"
  # Record this failure so it lands in the install report. _INSTALL_ISSUE_LOG_V1
  if command -v pbox_record_issue >/dev/null 2>&1; then
    pbox_record_issue "1" "${BASH_LINENO[0]:-?}" "error_exit: $*"
  fi
  echo ""
  echo "  If you are not sure how to fix this:"
  echo "    -  Press the Claude prompt above to ask the install assistant"
  echo "    -  Or open an issue at https://github.com/AI-PandorasBox/pandoras-box/issues"
  echo "       (attach the sanitised report: ${PBOX_REPORT:-~/Library/Logs/PandorasBox/install-latest.report})"
  echo ""
  exit 1
}

press_enter_to_continue() {
  echo -e "  ${C_CYAN}Press Return to continue...${C_RESET}"
  read -r
}

prompt_required() {
  local label="$1"
  local var_name="$2"
  local value=""
  while [[ -z "$value" ]]; do
    read -rp "  $label: " value
    if [[ -z "$value" ]]; then
      warn_msg "This field is required. Please enter a value."
    fi
  done
  eval "$var_name=\"$value\""
}

prompt_with_default() {
  local label="$1"
  local default="$2"
  local var_name="$3"
  read -rp "  $label [default: $default]: " value
  value="${value:-$default}"
  eval "$var_name=\"$value\""
}

prompt_yes_no() {
  # prompt_yes_no "question" default_var_name
  # default is "yes" if third arg omitted
  local question="$1"
  local var_name="$2"
  local default="${3:-yes}"
  local hint
  if [[ "$default" =~ ^[Yy] ]]; then hint="[Y/n]"; else hint="[y/N]"; fi
  local answer
  read -rp "  $question $hint: " answer
  answer="${answer:-$default}"
  if [[ "$answer" =~ ^[Yy] ]]; then
    eval "$var_name=yes"
  else
    eval "$var_name=no"
  fi
}

# =============================================================================
# print_module_info_card -- Standard info card shown before every optional
# module install / per-module credential collection. Every setup-X.sh that
# walks the user through a choice MUST call this first.
#
# Usage:
#   print_module_info_card "Module name" \
#     "What it does (one paragraph, plain English)." \
#     "What you will need (comma-separated list, or 'Nothing')." \
#     "Third-party costs (e.g. 'Free tier sufficient', '£5-20/month', 'Pay per use')." \
#     "Install time (e.g. '~2 minutes', '5-10 minutes')."
# =============================================================================
print_module_info_card() {
  local name="$1"
  local what="$2"
  local needs="$3"
  local costs="$4"
  local time="$5"

  echo ""
  echo "  ${C_BOLD}── ${name} ──${C_RESET}"
  echo ""
  echo "  ${C_BOLD}What it does${C_RESET}"
  printf "    %s\n" "$what" | fold -s -w 70 | sed 's/^/    /'
  echo ""
  echo "  ${C_BOLD}What you will need${C_RESET}"
  printf "    %s\n" "$needs" | fold -s -w 70 | sed 's/^/    /'
  echo ""
  echo "  ${C_BOLD}Third-party costs${C_RESET}"
  printf "    %s\n" "$costs" | fold -s -w 70 | sed 's/^/    /'
  echo ""
  echo "  ${C_BOLD}Install time${C_RESET}"
  echo "    $time"
  echo ""
}

# =============================================================================
# offer_module -- Prompt the user "Install this module? [y/N]" using info_card.
# Returns 0 if yes, 1 if no.
# =============================================================================
offer_module() {
  local name="$1"
  local what="$2"
  local needs="$3"
  local costs="$4"
  local time="$5"
  local default="${6:-no}"

  print_module_info_card "$name" "$what" "$needs" "$costs" "$time"
  prompt_yes_no "Install $name?" _module_choice "$default"
  if [[ "$_module_choice" == "yes" ]]; then
    return 0
  else
    return 1
  fi
}

create_service_account() {
  # OS-aware: delegates to the portability layer (dscl on macOS, useradd on Linux).
  pbox_create_service_account "$@"
}

write_plist() {
  local plist_path="$1"
  local label="$2"
  local program="$3"
  local run_as_user="$4"
  local log_path="$5"
  shift 5
  local env_args=("$@")

  cat > "/tmp/pbox-plist-tmp.plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PBOX_NODE_BIN:-/usr/local/bin/node}</string>
    <string>$program</string>
  </array>
  <key>UserName</key>
  <string>$run_as_user</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$log_path</string>
  <key>StandardErrorPath</key>
  <string>$log_path</string>
PLISTEOF

  if [[ ${#env_args[@]} -gt 0 ]]; then
    echo "  <key>EnvironmentVariables</key>" >> "/tmp/pbox-plist-tmp.plist"
    echo "  <dict>" >> "/tmp/pbox-plist-tmp.plist"
    for pair in "${env_args[@]}"; do
      local key="${pair%%=*}"
      local val="${pair#*=}"
      echo "    <key>$key</key><string>$val</string>" >> "/tmp/pbox-plist-tmp.plist"
    done
    echo "  </dict>" >> "/tmp/pbox-plist-tmp.plist"
  fi

  echo "</dict></plist>" >> "/tmp/pbox-plist-tmp.plist"
  sudo cp "/tmp/pbox-plist-tmp.plist" "$plist_path"
  sudo chown root:wheel "$plist_path"
  sudo chmod 644 "$plist_path"
  rm -f "/tmp/pbox-plist-tmp.plist"
}

write_env_file() {
  local env_path="$1"
  shift
  local pairs=("$@")

  local content=""
  for pair in "${pairs[@]}"; do
    content+="$pair"$'\n'
  done

  sudo bash -c "cat > '$env_path'" <<< "$content"
  sudo chmod 600 "$env_path"
}

# _A5_INSTALLER_UX_V1 -- helpers appended to lib/setup-core.sh
#
# Adds: setup-guide links, agent topology explainer, pre/post-install summaries,
# module dependency pre-checks, installed-skills display, themed preview lines.

# Print a "see also" pointer to a docs/setup/<name>.md guide just before any
# credential prompt. Used by every lib/setup-X.sh that asks for an API key
# or token. Keeps the prompt self-documenting.
#
# Usage: print_setup_guide_link <guide-name>
#   e.g. print_setup_guide_link elevenlabs
print_setup_guide_link() {
  local guide="$1"
  local url_base="https://github.com/AI-PandorasBox/pandoras-box/blob/main/docs/setup"
  echo ""
  echo "  ${C_DIM:-}Setup guide for $guide:${C_RESET:-}"
  echo "    Local: docs/setup/${guide}.md"
  echo "    Web:   ${url_base}/${guide}.md"
  echo ""
}

# Three-tier agent topology explainer. Surfaces the mental model before any
# heavy install work so operators understand what they're building.
topology_explainer() {
  section_header "What you're about to install"
  echo "  Pandora's Box gives you three kinds of agent:"
  echo ""
  echo "  ${C_BOLD}Admin agent${C_RESET} (always installed)  ${C_DIM:-}[REQUIRED]${C_RESET:-}"
  echo "    Lives at your terminal. Runs as YOU. Can build features."
  echo "    No external connectivity."
  echo ""
  echo "  ${C_BOLD}Personal AI${C_RESET} (always installed)  ${C_DIM:-}[REQUIRED]${C_RESET:-}"
  echo "    Your phone + desktop assistant. Cross-tenant read access;"
  echo "    sends only with your confirmation."
  echo ""
  echo "  ${C_BOLD}Business agent${C_RESET} (one per company tenant)  ${C_DIM:-}[OPTIONAL — 0 or more]${C_RESET:-}"
  echo "    A team of 4-6 small agents: mail, calendar, files, voice,"
  echo "    plus optional marketing and web. Default install: 1 tenant."
  echo "    Add more later via 'add-tenant' command."
  echo ""
  press_enter_to_continue
}

# Early preview shown right after topology_explainer so the operator knows
# how many steps + roughly how long before they're committed.
pre_install_preview() {
  section_header "Installation preview"
  echo "  This installer walks ${STEP_TOTAL:-11} steps."
  echo "  Total time: typically 25-45 minutes depending on which modules you"
  echo "  add. Most of that is downloads (Node packages, Tailscale,"
  echo "  optional Docker/Kiwix). Decision time is short."
  echo ""
  echo "  You can pause and resume at any optional step. Re-running the"
  echo "  installer is safe — completed steps are detected and skipped."
  echo ""
  echo "  You'll be asked for:"
  echo "    • a Claude Pro/Max account (or API key)            [step 1]"
  echo "    • a theme pack to name your agents                  [step 2]"
  echo "    • spend limits + provider keys                      [step 3]"
  echo "    • Tailscale sign-in (for mobile access)             [step 4]"
  echo "    • per-tenant credentials (one set per company)      [step 7]"
  echo "    • optional module choices                           [step 9]"
  echo ""
  prompt_yes_no "Ready to start?" _continue_choice "yes"
  if [[ "$_continue_choice" != "yes" ]]; then
    echo ""
    echo "  Bailing out. Re-run this installer when you're ready."
    exit 0
  fi
  echo ""
}

# Final summary shown AFTER module selection but BEFORE the heavy install
# work for each module. Lets the operator confirm the full selection.
post_selection_summary() {
  section_header "Selected install plan"
  echo "  Tier:           ${SETUP_PATH_NAME:-Personal / Single Organisation}"
  echo "  Theme:          ${THEME_NAME:-(none)}"
  echo "  Companies:      ${COMPANY_COUNT:-0}"
  echo ""
  echo "  Modules selected:"
  for k in ${SELECTED_MODULES_LIST:-}; do
    echo "    • $k"
  done
  echo ""
  echo "  Estimated monthly cost (third-party APIs):"
  echo "    • Anthropic (Claude Pro/Max): typically £18-£40/month if not"
  echo "      already subscribed. Otherwise: £0."
  if [[ " ${SELECTED_MODULES_LIST:-} " == *" voice "* ]] || [[ " ${SELECTED_MODULES_LIST:-} " == *" personal-ai "* ]]; then
    echo "    • ElevenLabs (Voice): £4-£10/month depending on usage"
  fi
  if [[ " ${SELECTED_MODULES_LIST:-} " == *" media-production "* ]]; then
    echo "    • Google AI (Imagen/Veo): £5-£40/month depending on content"
  fi
  echo "    • Microsoft 365: charged separately by your tenant; no extra"
  echo "      cost for the API access we use."
  echo ""
  echo "  Most operators land between £20 and £60 per month, all-in."
  echo ""
  prompt_yes_no "Proceed with install?" _proceed_choice "yes"
  if [[ "$_proceed_choice" != "yes" ]]; then
    echo ""
    echo "  Stopping here. Selections are saved in /tmp/pbox-selections.json"
    echo "  Re-run the installer to continue (your choices will be remembered)."
    exit 0
  fi
  echo ""
}

# Soft pre-check for a third-party dependency. Reports status and offers
# options if the dep isn't found.
#
# Usage: check_module_dep <module-name> <dep-binary> <install-hint>
#   e.g. check_module_dep "the Offline Knowledge Library" "docker" "brew install --cask docker"
#
# Sets MODULE_DEP_OK=true|false for the caller to use.
check_module_dep() {
  local mod="$1"; local dep="$2"; local hint="$3"
  if command -v "$dep" &>/dev/null; then
    success_msg "$mod dependency '$dep' found."
    MODULE_DEP_OK=true
    return 0
  fi
  echo ""
  warn_msg "$mod requires '$dep' but it's not installed on this Mac."
  echo "  Install hint: $hint"
  echo ""
  echo "  [1] Pause installer; install '$dep' in another terminal, then continue"
  echo "  [2] Skip $mod for this run (add later via add-module.sh)"
  echo "  [3] Continue anyway — $mod step will likely fail (not recommended)"
  echo ""
  read -rp "  Choose [1/2/3, default 2]: " _dep_choice
  _dep_choice="${_dep_choice:-2}"
  case "$_dep_choice" in
    1) read -rp "  Install '$dep' in another terminal, then press Enter to continue: " _ack
       if command -v "$dep" &>/dev/null; then
         success_msg "$dep detected. Continuing."
         MODULE_DEP_OK=true; return 0
       else
         warn_msg "$dep still not found. Skipping $mod."
         MODULE_DEP_OK=false; return 1
       fi ;;
    3) warn_msg "Proceeding with $mod despite missing $dep."
       MODULE_DEP_OK=true; return 0 ;;
    *) info_msg "Skipping $mod for this run."
       MODULE_DEP_OK=false; return 1 ;;
  esac
}

# Read-only display of skills shipped with the Personal AI's default install.
# Called right after run_personal_ai_setup so the operator sees what capabilities
# their assistant gains automatically.
display_installed_skills() {
  section_header "Skills your Personal AI ships with"
  local manifest="${INSTALL_PATH:-/opt/pandoras-box}/shared/skills/manifest.json"
  if [[ ! -f "$manifest" ]]; then
    echo "  (Skill manifest not found at $manifest — skills will be installed"
    echo "  by the Personal AI step. Re-run this display via add-module.sh"
    echo "  --show-skills to see them after install.)"
    echo ""
    return 0
  fi
  if command -v jq &>/dev/null; then
    local count
    count=$(jq -r '.skills | length' "$manifest" 2>/dev/null || echo "0")
    echo "  $count skill(s) installed:"
    echo ""
    jq -r '.skills[] | "    • \(.name) v\(.version)\n      \(.description // "(no description)")\n"' "$manifest" 2>/dev/null
  else
    echo "  (jq not installed — see $manifest directly for the list.)"
  fi
  echo "  More skills can be added later via the auto-improvement pipeline"
  echo "  (the Personal AI proposes new skills based on patterns in your usage)."
  echo ""
  press_enter_to_continue
}
