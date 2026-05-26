# =============================================================================
# setup-personal-ai.sh -- Personal Assistant setup
# Includes: Obsidian vault connection, voice (ElevenLabs), web search (Brave),
# Gemini Create-tab tools (optional). Composed of reusable subroutines.
# (Filename retained for backward compatibility with existing source paths.)
# =============================================================================

# Sourced by pbox-setup.sh so the run_*_setup helpers are available:
#   run_voice_setup        (lib/setup-voice.sh)
#   run_brave_search_setup (lib/setup-brave-search.sh)
#   run_gemini_setup       (lib/setup-gemini.sh)
#   run_obsidian_setup     (defined below)

run_personal_ai_setup() {
  # No top-level dry-run guard -- each sub-step (voice / brave / gemini /
  # obsidian) handles dry-run independently, and we want the dry-run to
  # exercise the personal-ai module installer at the end too.
  section_header "Personal Assistant"
  echo "  Your Personal Assistant is the AI that knows you, holds your context,"
  echo "  and helps with email, calendar, research, writing, briefings, and more."
  echo "  This step configures the assistant itself; optional add-ons (voice,"
  echo "  web search, Gemini tools, your Obsidian vault) are offered next."
  echo ""

  # Core Personal AI choices first
  local PERSONAL_AI_PORT PERSONAL_AI_NAME
  prompt_with_default "Personal Assistant port (default fine)" "8800" PERSONAL_AI_PORT
  prompt_with_default "Display name for your assistant" "Assistant" PERSONAL_AI_NAME
  export PERSONAL_AI_PORT PERSONAL_AI_NAME

  echo ""
  info_msg "Now offering optional add-ons. Each is independent."
  echo ""

  # Add-ons in order: voice -> web search -> Gemini Create-tab -> Obsidian vault
  run_voice_setup        || warn_msg "Voice setup skipped or failed -- continuing."
  run_brave_search_setup || warn_msg "Brave Search setup skipped or failed -- continuing."
  run_gemini_setup       || warn_msg "Gemini setup skipped or failed -- continuing."
  run_obsidian_setup     || warn_msg "Obsidian setup skipped or failed -- continuing."

  # Invoke the personal-ai module installer to stage the runtime + register the
  # LaunchDaemon (v0.3 ships a placeholder; v0.4 will land the full runtime here).
  if [[ -x "$INSTALL_PATH/modules/personal-ai/install.sh" ]]; then
    info_msg "Running personal-ai module installer..."
    sudo bash "$INSTALL_PATH/modules/personal-ai/install.sh" || warn_msg "personal-ai install reported a non-zero exit"
  else
    warn_msg "personal-ai module install.sh not found -- staging step did not complete?"
  fi

  echo ""
  success_msg "Personal Assistant configured."
  echo ""
}

# -----------------------------------------------------------------------------
# Obsidian vault integration -- connect the Personal AI to a personal Obsidian vault.
# Lets the assistant read your daily notes, journal entries, project pages,
# meeting notes -- and write new entries when you ask.
# -----------------------------------------------------------------------------
run_obsidian_setup() {
  print_module_info_card \
    "Obsidian vault (notes/journal context)" \
    "Connects your Personal Assistant to an Obsidian vault on this Mac. The assistant gets four tools: vault_read (open a specific note), vault_write (create or update a note), vault_search (full-text search), vault_list (browse folders). Useful for: daily notes that the morning briefing pulls in, project pages that meeting prep can reference, journal entries the assistant can summarise on request, and idea capture that survives the chat session. Read access is broad; write access is scoped to a 'Pandoras Box' subfolder by default so the assistant cannot edit your existing notes unless you ask explicitly." \
    "An Obsidian vault on this Mac (any local folder Obsidian recognises). The full path to the vault root. Optional: a subfolder name where the assistant is allowed to write (default: 'Pandoras Box')." \
    "Free. Obsidian itself is free for personal use. No third-party API." \
    "~2 minutes"

  prompt_yes_no "Connect an Obsidian vault to your Personal Assistant?" o_choice "no"
  if [[ "$o_choice" != "yes" ]]; then
    info_msg "Skipping Obsidian. The Personal Assistant still works -- it just"
    info_msg "won't have access to your notes/journal."
    export PERSONAL_AI_OBSIDIAN_VAULT=""
    return 0
  fi

  echo ""
  echo "  Common vault locations:"
  echo "    -  ~/Documents/Obsidian"
  echo "    -  ~/Obsidian"
  echo "    -  ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>"
  echo "       (iCloud-synced -- the assistant only reads when iCloud has"
  echo "       finished syncing, which can introduce a few seconds of lag)"
  echo ""

  local vault_path=""
  while [[ -z "$vault_path" ]]; do
    read -rp "  Full path to your Obsidian vault root: " vault_path
    # Expand ~ if present
    vault_path="${vault_path/#\~/$HOME}"
    if [[ ! -d "$vault_path" ]]; then
      warn_msg "Path '$vault_path' does not exist. Try again or press Ctrl+C to skip."
      vault_path=""
      continue
    fi
    # Sanity: does it look like a vault?
    if [[ ! -d "$vault_path/.obsidian" ]]; then
      warn_msg "No .obsidian folder inside '$vault_path' -- this may not be a vault. Continue anyway? [y/N]"
      read -r confirm
      if [[ ! "$confirm" =~ ^[Yy] ]]; then
        vault_path=""
        continue
      fi
    fi
  done
  check_pass "Vault root: $vault_path"

  echo ""
  prompt_with_default "Subfolder where the assistant may write new notes" "Pandoras Box" vault_writable_folder

  # Create the writable subfolder if missing
  local writable_path="$vault_path/$vault_writable_folder"
  if [[ ! -d "$writable_path" ]]; then
    mkdir -p "$writable_path"
    cat > "$writable_path/README.md" <<EOF
# Pandoras Box notes

This folder is the only writable scope inside your Obsidian vault for the
Personal Assistant on Pandoras Box. Notes written here come from:

- Daily summaries you asked for
- Meeting prep you asked for
- Captured ideas via voice or chat
- Backups of important assistant-side memory

The rest of your vault is read-only to the assistant.

You can move notes out of this folder freely; the assistant won't write back
to them.
EOF
    check_pass "Created writable subfolder: $writable_path"
  fi

  echo ""
  echo "  Default folder structure (the assistant will create these on first use):"
  echo "    $vault_writable_folder/Daily/        -- morning briefings + day-end notes"
  echo "    $vault_writable_folder/Meetings/     -- meeting prep + follow-ups"
  echo "    $vault_writable_folder/Captures/     -- voice/chat captures"
  echo "    $vault_writable_folder/Threads/      -- conversational threads worth keeping"
  echo ""

  prompt_yes_no "Index the existing vault now (full-text search build)?" idx_now "yes"
  if [[ "$idx_now" == "yes" ]]; then
    info_msg "Vault indexing runs in the background after install completes."
    info_msg "Track progress: tail -f /tmp/personal-ai-vault-index.log"
  fi

  export PERSONAL_AI_OBSIDIAN_VAULT="$vault_path"
  export PERSONAL_AI_OBSIDIAN_WRITABLE="$vault_writable_folder"
  echo ""
  success_msg "Obsidian vault connected."
  echo ""
}
