# =============================================================================
# setup-mail-google.sh -- Gmail / Google Workspace mail backend per company
# Alternative to MS365 in setup-company.sh.
# =============================================================================

run_mail_google_setup_for_company() {
  # _A5_INSTALLER_UX_V1 -- point operator at the matching setup guide
  print_setup_guide_link "ms365"
  local slug="$1"
  local display_name="$2"

  print_module_info_card \
    "Gmail / Google Workspace for ${display_name}" \
    "Connects ${display_name}'s mail agent to Gmail or a Google Workspace mailbox via OAuth. Read inbox, draft replies (sent only after you approve them via the Personal Assistant or directly via the Telegram bot), search threads. Same scope discipline as MS365: mail agent gets mail credentials only -- no calendar, no files." \
    "A Google Workspace OAuth client (Cloud Console -> Credentials -> OAuth client -> Desktop app). Gmail API + People API enabled on the project. Refresh-token-grant scopes. The user account (e.g. office@${slug}.com) you want the agent to read." \
    "Free for personal Gmail. Google Workspace: ~£5-15/user/month (your existing subscription)." \
    "~5 minutes"

  prompt_yes_no "Use Gmail/Google Workspace for ${display_name}?" g_choice "yes"
  if [[ "$g_choice" != "yes" ]]; then
    eval "GMAIL_CLIENT_ID_${slug}=\"\""
    eval "GMAIL_CLIENT_SECRET_${slug}=\"\""
    eval "GMAIL_USER_${slug}=\"\""
    return 0
  fi

  echo ""
  echo "  1. Go to https://console.cloud.google.com/apis/credentials"
  echo "  2. Create or pick a project for $display_name"
  echo "  3. Enable APIs: Gmail API, People API, Google Calendar API"
  echo "  4. OAuth consent screen -> External -> add your email as a test user"
  echo "  5. Credentials -> Create OAuth client ID -> Desktop app -> name it"
  echo "     '$display_name Pandoras Box agent' -> Create"
  echo "  6. Copy the Client ID + Client Secret"
  echo ""
  press_enter_to_continue

  prompt_required "OAuth Client ID for $display_name" g_cid
  read -rsp "  OAuth Client Secret (hidden): " g_csec
  echo ""
  prompt_required "Mailbox to read (e.g. office@$slug.com)" g_user

  eval "GMAIL_CLIENT_ID_${slug}='$g_cid'"
  eval "GMAIL_CLIENT_SECRET_${slug}='$g_csec'"
  eval "GMAIL_USER_${slug}='$g_user'"

  echo ""
  info_msg "On first run, the agent will open a browser for you to grant access."
  info_msg "Sign in as $g_user and approve the requested scopes."
  echo ""
  success_msg "Gmail/Google Workspace configured for $display_name."
}
