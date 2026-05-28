# =============================================================================
# setup-offline-kb.sh -- the Offline Knowledge Library: offline knowledge base (Kiwix + ZIM files)
# =============================================================================

run_offline_kb_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "the Offline Knowledge Library (offline knowledge base)" \
    "An offline knowledge base your Personal Assistant can search without spending money on web search APIs. Indexes a curated library: Wikipedia (offline ZIM), Stack Overflow, iFixit, Khan Academy, Project Gutenberg, programming reference manuals. The assistant prefers the Offline Knowledge Library for stable reference content (technical docs, how-tos, history, biographies) and only falls back to live web search for current events. Significantly reduces Brave Search quota burn." \
    "Disk space: 50-150 GB depending on which ZIM files you choose. Wikipedia alone is ~95 GB. Stack Overflow ~30 GB. Optional: Docker (Kiwix runs in a container)." \
    "Free. ZIM files are free downloads from https://download.kiwix.org/zim/. No subscription." \
    "~30 minutes (mostly the first ZIM download -- 50+ GB at home broadband)"

  prompt_yes_no "Set up the Offline Knowledge Library now?" a_choice "no"
  if [[ "$a_choice" != "yes" ]]; then return 0; fi

  # Disk-space check (portable: BSD `df -g` differs from GNU; compute from POSIX -P).
  local FREE_GB
  FREE_GB=$(df -P /opt 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')
  if [[ -n "$FREE_GB" && "$FREE_GB" -lt 60 ]]; then
    warn_msg "Only ${FREE_GB} GB free on /opt -- the Offline Knowledge Library needs at least 60 GB. Free up space and re-run."
    return 1
  fi
  check_pass "Disk space: ${FREE_GB:-unknown} GB free"

  # Docker (OS-aware: brew cask on macOS, apt docker.io on Linux)
  if ! command -v docker &>/dev/null; then
    warn_msg "Docker not installed. the Offline Knowledge Library needs Docker for Kiwix."
    if [[ "$PBOX_OS" == Darwin ]]; then
      prompt_yes_no "Install Docker now (via Homebrew Cask)?" d_install "yes"
      if [[ "$d_install" == "yes" ]]; then
        brew install --cask docker 2>&1 | tail -3
        info_msg "Open Docker Desktop manually once before continuing (it needs first-run setup)."
        press_enter_to_continue
      else
        info_msg "Skipping the Offline Knowledge Library. Re-run after Docker is available."
        return 0
      fi
    else
      prompt_yes_no "Install Docker now (via apt: docker.io)?" d_install "yes"
      if [[ "$d_install" == "yes" ]]; then
        sudo apt-get install -y docker.io 2>&1 | tail -3
        sudo systemctl enable --now docker 2>&1 | tail -3 || true
      else
        info_msg "Skipping the Offline Knowledge Library. Re-run after Docker is available."
        return 0
      fi
    fi
  fi

  echo ""
  echo "  ${C_BOLD}Sources to download${C_RESET} (you can add more later):"
  prompt_yes_no "Wikipedia (English, full, ~95 GB)" OFFLINE_KB_WIKI "yes"
  prompt_yes_no "Stack Overflow (~30 GB)" OFFLINE_KB_SO "yes"
  prompt_yes_no "iFixit repair guides (~3 GB)" OFFLINE_KB_IFIXIT "yes"
  prompt_yes_no "Project Gutenberg (~80 GB, lots of literature)" OFFLINE_KB_GUTENBERG "no"
  prompt_yes_no "Khan Academy (~12 GB)" OFFLINE_KB_KA "no"

  echo ""
  info_msg "Downloads run in the background after install completes."
  info_msg "Track progress: tail -f /tmp/offline-kb-zim-download.log"
  echo ""
  export OFFLINE_KB_WIKI OFFLINE_KB_SO OFFLINE_KB_IFIXIT OFFLINE_KB_GUTENBERG OFFLINE_KB_KA
  success_msg "the Offline Knowledge Library enabled."
}
