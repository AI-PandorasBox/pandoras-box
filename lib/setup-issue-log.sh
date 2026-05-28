# _INSTALL_ISSUE_LOG_V1
# =============================================================================
# setup-issue-log.sh -- structured install logging + sanitised bug-report bundle
# Sourced by pbox-setup.sh. Initialised from main() before the transcript tee.
#
# Produces, under ~/Library/Logs/PandorasBox/ :
#   install-<ts>.log          full transcript (tee target). LOCAL ONLY (mode 600).
#   install-issues-<ts>.jsonl structured {env|issue|fix} records.
#   install-report-<ts>.txt   SANITISED bundle, safe to attach to a bug report.
# Plus stable symlinks: install-latest.{log,jsonl,report}.
#
# No network. No telemetry. No phone-home. The operator attaches the report by
# hand. The raw transcript and the jsonl may contain values the operator typed
# and are kept mode 600; the only artifact we tell the operator to share is the
# sanitised report.
# =============================================================================

PBOX_LOG_DIR="${HOME}/Library/Logs/PandorasBox"
PBOX_RUN_TS=""
PBOX_INSTALL_LOG=""
PBOX_ISSUE_LOG=""
PBOX_REPORT=""
PBOX_ISSUE_COUNT=0

# Minimal JSON string escaper (backslash, quote, control chars, newlines/tabs).
pbox_jsonesc() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//	/\\t}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  printf '%s' "$s"
}

# Strip common secret shapes from stdin. Defence-in-depth: the real protection
# is that secrets the operator types at a `read` prompt are not echoed to the
# transcript by the shell. This catches residual cases (values that get echoed,
# env files, key=value lines) plus the operator's home username and email.
pbox_sanitise() {
  local user
  user="$(whoami 2>/dev/null || echo user)"
  sed -E \
    -e 's/sk-ant-[A-Za-z0-9_-]{8,}/[REDACTED:anthropic-key]/g' \
    -e 's/sk-[A-Za-z0-9]{20,}/[REDACTED:api-key]/g' \
    -e 's/AIza[0-9A-Za-z_-]{35}/[REDACTED:google-key]/g' \
    -e 's/tskey-[A-Za-z0-9-]{10,}/[REDACTED:tailscale-key]/g' \
    -e 's/xox[baprs]-[A-Za-z0-9-]{10,}/[REDACTED:slack-token]/g' \
    -e 's/gh[pousr]_[A-Za-z0-9]{20,}/[REDACTED:github-token]/g' \
    -e 's/[0-9]{8,10}:[A-Za-z0-9_-]{35}/[REDACTED:telegram-token]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED:jwt]/g' \
    -e 's/((API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CLIENT[_-]?SECRET|AUTH[_-]?KEY|BEARER)[[:space:]]*[=:][[:space:]]*)[^[:space:]",}]+/\1[REDACTED]/Ig' \
    -e 's/([Bb]earer[[:space:]]+)[A-Za-z0-9._~+/=-]{10,}/\1[REDACTED]/g' \
    -e 's#/Users/[^/[:space:]]+#/Users/[user]#g' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[REDACTED:email]/g' \
    -e "s/\\b${user}\\b/[user]/g" \
    2>/dev/null || cat
}

# Append a non-secret environment snapshot as the first jsonl record.
pbox_env_snapshot() {
  local os_ver os_build arch model ncpu mem_gb node_bin node_ver brew_ver free_disk
  if [[ "${PBOX_OS:-$(uname -s)}" == Darwin ]]; then
    os_ver="$(sw_vers -productVersion 2>/dev/null || echo '?')"
    os_build="$(sw_vers -buildVersion 2>/dev/null || echo '?')"
    model="$(sysctl -n hw.model 2>/dev/null || echo '?')"
    ncpu="$(sysctl -n hw.ncpu 2>/dev/null || echo '?')"
    mem_gb="$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))"
    brew_ver="$(brew --version 2>/dev/null | head -1 || echo none)"
  else
    # Linux: distro from /etc/os-release, kernel from uname, mem from /proc.
    local distro="Linux"
    [[ -r /etc/os-release ]] && distro="$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-Linux}")"
    os_ver="$distro"
    os_build="$(uname -r 2>/dev/null || echo '?')"
    model="$(uname -a 2>/dev/null || echo '?')"
    ncpu="$(nproc 2>/dev/null || echo '?')"
    mem_gb="$(( $(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1048576 ))"
    brew_ver="none"
  fi
  arch="$(uname -m 2>/dev/null || echo '?')"
  node_bin="${PBOX_NODE_BIN:-$(command -v node 2>/dev/null || echo none)}"
  node_ver="$("$node_bin" --version 2>/dev/null || echo none)"
  free_disk="$(df -h / 2>/dev/null | awk 'NR==2{print $4" free of "$2}')"
  printf '{"type":"env","ts":"%s","installer_version":"%s","macos":"%s (%s)","arch":"%s","model":"%s","cpu":"%s","ram_gb":"%s","node":"%s","node_path":"%s","brew":"%s","disk":"%s","shell":"%s","lang":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(pbox_jsonesc "${PBOX_VERSION:-?}")" \
    "$(pbox_jsonesc "$os_ver")" "$(pbox_jsonesc "$os_build")" \
    "$(pbox_jsonesc "$arch")" "$(pbox_jsonesc "$model")" "$(pbox_jsonesc "$ncpu")" "$mem_gb" \
    "$(pbox_jsonesc "$node_ver")" "$(pbox_jsonesc "$node_bin")" "$(pbox_jsonesc "$brew_ver")" \
    "$(pbox_jsonesc "$free_disk")" "$(pbox_jsonesc "${SHELL:-?}")" "$(pbox_jsonesc "${LANG:-?}")" \
    >> "$PBOX_ISSUE_LOG" 2>/dev/null || true
}

# Initialise the log dir + paths. Call from main() BEFORE the transcript tee.
# Redefines LOG_FILE so pbox-setup.sh's tee and messages use the persistent path.
pbox_issue_log_init() {
  mkdir -p "$PBOX_LOG_DIR" 2>/dev/null || true
  chmod 700 "$PBOX_LOG_DIR" 2>/dev/null || true
  PBOX_RUN_TS="$(date +%Y%m%d-%H%M%S)"
  PBOX_INSTALL_LOG="$PBOX_LOG_DIR/install-$PBOX_RUN_TS.log"
  PBOX_ISSUE_LOG="$PBOX_LOG_DIR/install-issues-$PBOX_RUN_TS.jsonl"
  PBOX_REPORT="$PBOX_LOG_DIR/install-report-$PBOX_RUN_TS.txt"
  : > "$PBOX_INSTALL_LOG"; : > "$PBOX_ISSUE_LOG"
  chmod 600 "$PBOX_INSTALL_LOG" "$PBOX_ISSUE_LOG" 2>/dev/null || true
  ln -sfn "$PBOX_INSTALL_LOG" "$PBOX_LOG_DIR/install-latest.log" 2>/dev/null || true
  ln -sfn "$PBOX_ISSUE_LOG"  "$PBOX_LOG_DIR/install-latest.jsonl" 2>/dev/null || true
  # Back-compat: keep the historical /tmp path pointing at the live transcript.
  ln -sfn "$PBOX_INSTALL_LOG" /tmp/pbox-install.log 2>/dev/null || true
  export LOG_FILE="$PBOX_INSTALL_LOG"
  pbox_env_snapshot
}

# Record a failed step. Called by the ERR trap and by error_exit.
pbox_record_issue() {
  local rc="$1" line="$2" cmd="$3" stage="${STEP_CURRENT:-0}/${STEP_TOTAL:-?}"
  [[ -z "${PBOX_ISSUE_LOG:-}" ]] && return 0
  PBOX_ISSUE_COUNT=$((PBOX_ISSUE_COUNT + 1))
  printf '{"type":"issue","ts":"%s","step":"%s","line":"%s","exit_code":"%s","command":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pbox_jsonesc "$stage")" \
    "$(pbox_jsonesc "$line")" "$(pbox_jsonesc "$rc")" "$(pbox_jsonesc "$cmd")" \
    >> "$PBOX_ISSUE_LOG" 2>/dev/null || true
}

# Record an on-the-fly fix / workaround. Public helper: call `record_fix "..."`
# from any step (or the Claude-diagnose path) whenever a workaround is applied.
pbox_record_fix() {
  local desc="$*" stage="${STEP_CURRENT:-0}/${STEP_TOTAL:-?}"
  [[ -z "${PBOX_ISSUE_LOG:-}" ]] && return 0
  printf '{"type":"fix","ts":"%s","step":"%s","description":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pbox_jsonesc "$stage")" "$(pbox_jsonesc "$desc")" \
    >> "$PBOX_ISSUE_LOG" 2>/dev/null || true
}
# Friendly alias for use inside installer steps.
record_fix() { pbox_record_fix "$@"; }

# ERR trap handler. Installed in main() with `set -E` so it fires inside funcs.
pbox_err_trap() {
  pbox_record_issue "$1" "$2" "$3"
}

# Build the sanitised, attachable report. Called on EXIT.
pbox_build_report() {
  [[ -z "${PBOX_REPORT:-}" ]] && return 0
  {
    echo "Pandoras Box install report"
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Setup path: ${SETUP_PATH:-unset}    Issues recorded: ${PBOX_ISSUE_COUNT}"
    echo "This file is sanitised and safe to attach to a GitHub issue."
    echo "============================================================"
    echo ""
    echo "## Environment + structured records"
    pbox_sanitise < "$PBOX_ISSUE_LOG" 2>/dev/null
    echo ""
    echo "## Last 200 lines of transcript (sanitised)"
    tail -n 200 "$PBOX_INSTALL_LOG" 2>/dev/null | pbox_sanitise
  } > "$PBOX_REPORT" 2>/dev/null || true
  chmod 644 "$PBOX_REPORT" 2>/dev/null || true
  ln -sfn "$PBOX_REPORT" "$PBOX_LOG_DIR/install-latest.report" 2>/dev/null || true
}

# EXIT trap. Builds the report and points the operator at it.
pbox_issue_log_finish() {
  local rc="$?"
  pbox_build_report
  echo ""
  if [[ "$PBOX_ISSUE_COUNT" -gt 0 || "$rc" -ne 0 ]]; then
    echo "  Some steps reported problems during this install."
    echo "  To get help, attach this SANITISED report to a bug report at"
    echo "  https://github.com/AI-PandorasBox/pandoras-box/issues :"
    echo "      ${PBOX_REPORT:-$PBOX_LOG_DIR}"
  else
    echo "  Install logs saved (sanitised report safe to share if you need help):"
    echo "      report:     ${PBOX_REPORT:-$PBOX_LOG_DIR}"
  fi
  echo "  Full local log (may contain secrets, keep private): ${PBOX_INSTALL_LOG:-/tmp/pbox-install.log}"
  echo ""
  return 0
}

# =============================================================================
# pbox_claude_help <context> -- offer a Claude-assisted diagnosis after a failure.
# Prompts the operator, then asks the Claude CLI (`claude -p`) to read the last
# 80 lines of the install log (sanitised) plus the failure context and return a
# terse explanation + the exact fix commands. No-op in dry-run, when claude is
# absent, or in non-interactive contexts.
# =============================================================================
pbox_claude_help() {
  local context="${1:-the installer hit an issue}"
  [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]] && return 0
  if ! command -v claude >/dev/null 2>&1; then
    info_msg "Claude CLI not on PATH; see ${PBOX_INSTALL_LOG:-/tmp/pbox-install.log} for the log."
    return 0
  fi
  [[ -t 0 ]] || return 0   # stdout is teed by pbox-setup; stdin tty is what we need
  echo ""
  local ans
  read -rp "  Ask Claude to diagnose this? [Y/n]: " ans
  ans="${ans:-Y}"
  [[ ! "$ans" =~ ^[Yy] ]] && return 0
  echo ""
  info_msg "Asking Claude (sanitised log + context). This may take ~10s..."
  local log_tail
  log_tail=$(tail -n 80 "${PBOX_INSTALL_LOG:-/tmp/pbox-install.log}" 2>/dev/null | { pbox_sanitise 2>/dev/null || cat; } | head -c 12000)
  local out
  out=$(claude -p --output-format text 2>&1 <<CLAUDEEOF || true
The Pandoras Box installer hit an issue: ${context}

Diagnose the failure from the log tail below. Give a 3-5 line explanation in plain English, then the exact command(s) the operator can run to fix it. Be terse.

--- INSTALL LOG (last 80 lines, sanitised) ---
${log_tail}
CLAUDEEOF
)
  echo "  ── Claude says ──"
  printf '%s\n' "$out" | sed 's/^/  /' | head -40
  echo "  ─────────────────"
  echo ""
}
