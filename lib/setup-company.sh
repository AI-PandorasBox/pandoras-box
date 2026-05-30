# =============================================================================
# setup-company.sh -- Per-company agent setup (conductor + 4 task agents)
# =============================================================================

run_company_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  section_header "Mailboxes, calendars, and chat relays"
  echo "  This step connects one or more email/calendar accounts to your"
  echo "  Personal Assistant. Each one can be Microsoft 365 or Google."
  echo "  Telegram / Slack / Discord / WhatsApp relays for each account are"
  echo "  offered inside this step."
  echo ""
  echo "  You can call an account anything you like:"
  echo "    -  'Personal' for your own mail / calendar"
  echo "    -  a company name for a work account"
  echo "    -  add several (each runs in its own isolated agent)"
  echo ""
  echo "  ${C_YELLOW}If you enter 0, the assistant will run as chat-only.${C_RESET}"
  echo "  ${C_YELLOW}No mail, calendar, or chat relay setup will run.${C_RESET}"
  echo ""

  prompt_with_default "How many mailboxes / calendars to connect?" "1" COMPANY_COUNT
  export COMPANY_COUNT

  if [[ "$COMPANY_COUNT" == "0" ]]; then
    echo ""
    warn_msg "You chose 0. The assistant will start with no mail or calendar."
    info_msg "You can add accounts later: bash $INSTALL_PATH/lib/setup-company.sh"
    echo ""
    local confirm
    prompt_yes_no "Continue with no mailboxes / calendars?" confirm "no"
    if [[ "$confirm" != "yes" ]]; then
      info_msg "OK -- back to the count prompt."
      prompt_with_default "How many mailboxes / calendars to connect?" "1" COMPANY_COUNT
      export COMPANY_COUNT
    fi
  fi

  local i
  for i in $(seq 1 "$COMPANY_COUNT"); do
    echo ""
    echo "  ── Account $i of $COMPANY_COUNT ──"
    echo ""
    setup_single_company "$i"
  done
}

setup_single_company() {
  local company_index="$1"

  echo "  Label for this account (use 'Personal' for your own, or a company name):"
  prompt_with_default "  Account label" "Personal" COMPANY_DISPLAY_NAME
  local company_slug
  company_slug=$(echo "$COMPANY_DISPLAY_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
  info_msg "Account slug: $company_slug (used in file and service names)"
  echo ""

  echo "  What email system does this account use?"
  echo "  1) Microsoft 365 (Outlook / Exchange / Hotmail / Live)"
  echo "  2) Google (Gmail / Workspace)"
  echo "  3) Skip mail + calendar for this account (just create the slot)"
  echo ""
  read -rp "  Enter 1, 2, or 3: " email_choice

  case "$email_choice" in
    1) setup_company_ms365 "$company_slug" "$COMPANY_DISPLAY_NAME" ;;
    2) setup_company_google "$company_slug" "$COMPANY_DISPLAY_NAME" ;;
    3) info_msg "Skipping mail/calendar -- account slot will be chat-only." ;;
    *) warn_msg "Invalid choice. Defaulting to Microsoft 365."
       setup_company_ms365 "$company_slug" "$COMPANY_DISPLAY_NAME" ;;
  esac
}

setup_company_ms365() {
  local slug="$1"
  local display_name="$2"

  echo ""
  echo "  --- Microsoft 365 Setup for $display_name ---"
  echo ""
  echo "  To connect to Microsoft 365, you need to register Pandoras Box"
  echo "  as an application in your Azure portal. This is a one-time setup."
  echo ""
  echo "  What is Azure? Azure is Microsoft's cloud platform. Even if you"
  echo "  just use Microsoft 365 for email, your organisation has an Azure"
  echo "  account associated with it."
  echo ""
  echo "  Step 1: Go to portal.azure.com and sign in with your Microsoft 365"
  echo "  admin account (this is usually the account you use to add/remove users)."
  echo ""
  echo "  Step 2: Search for 'App registrations' in the search bar at the top."
  echo "  Click 'App registrations' in the results."
  echo ""
  echo "  Step 3: Click 'New registration'."
  echo "  - Name: Pandoras Box ($display_name)"
  echo "  - Supported account types: 'Accounts in this organizational directory only'"
  echo "  - Redirect URI: leave blank"
  echo "  - Click Register"
  echo ""
  press_enter_to_continue
  echo ""
  echo "  Step 4: You are now on the app's overview page. You need two values:"
  echo "  - 'Application (client) ID' -- copy this"
  echo "  - 'Directory (tenant) ID'   -- copy this"
  echo ""
  prompt_required "Paste your Application (client) ID" MS365_CLIENT_ID
  prompt_required "Paste your Directory (tenant) ID" MS365_TENANT_ID
  echo ""
  echo "  Step 5: Add permissions."
  echo "  Click 'API permissions' in the left sidebar."
  echo "  Click 'Add a permission' -> 'Microsoft Graph' -> 'Application permissions'."
  echo "  Search for and add each of these:"
  echo "    Mail.ReadWrite"
  echo "    Mail.Send"
  echo "    Calendars.ReadWrite"
  echo "    Files.ReadWrite.All"
  echo "  Then click 'Grant admin consent' and confirm."
  echo ""
  press_enter_to_continue
  echo ""
  echo "  Step 6: Create a client secret."
  echo "  Click 'Certificates & secrets' in the left sidebar."
  echo "  Click 'New client secret'."
  echo "  - Description: Pandoras Box"
  echo "  - Expires: 24 months"
  echo "  - Click Add"
  echo "  Copy the 'Value' column immediately -- it is only shown once."
  echo ""
  read -rsp "  Paste your client secret (input hidden): " MS365_CLIENT_SECRET
  echo ""
  echo ""

  local base_dir="$INSTALL_PATH/$slug"
  local uid_base=500
  local service_user="${slug}-agent"

  echo "  Setting up file structure for $display_name..."
  create_service_account "$service_user" "$((uid_base + company_index))" "$display_name Agent"
  sudo mkdir -p "$base_dir" "$INSTALL_PATH/${slug}-conductor" \
    "$INSTALL_PATH/${slug}-mail" "$INSTALL_PATH/${slug}-calendar" \
    "$INSTALL_PATH/${slug}-files" "$INSTALL_PATH/${slug}-voice" \
    "$INSTALL_PATH/${slug}-voice-call"
  sudo chown -R "${service_user}:staff" "$base_dir" "$INSTALL_PATH/${slug}-"*
  sudo chmod 750 "$base_dir" "$INSTALL_PATH/${slug}-"*

  write_env_file "$base_dir/.env" \
    "MS365_CLIENT_ID=$MS365_CLIENT_ID" \
    "MS365_TENANT_ID=$MS365_TENANT_ID" \
    "MS365_CLIENT_SECRET=$MS365_CLIENT_SECRET" \
    "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
    "COMPANY_SLUG=$slug" \
    "COMPANY_NAME=$display_name"

  install_tenant_runtimes "$slug" "$service_user"

  check_pass "Company '$display_name' configured ($slug)."
  echo ""
  echo "  Next: run the Microsoft 365 authentication flow to grant access."
  echo "  This will open a browser window for you to sign in."
  echo ""
  echo "  Run: node $base_dir/node_modules/@softeria/ms-365-mcp-server/dist/index.js --login --org-mode"
  echo "  (This step will be available after you install the packages.)"
  echo ""
  press_enter_to_continue
}

setup_company_google() {
  local slug="$1"
  local display_name="$2"

  echo ""
  echo "  --- Google Workspace Setup for $display_name ---"
  echo ""
  echo "  To connect to Google Workspace, you need to create a project in"
  echo "  Google Cloud Console and enable the APIs Pandoras Box needs."
  echo ""
  echo "  Step 1: Go to console.cloud.google.com and sign in."
  echo ""
  echo "  Step 2: Create a new project."
  echo "  Click the project selector at the top -> 'New Project'."
  echo "  Name: Pandoras Box ($display_name)"
  echo "  Click Create."
  echo ""
  press_enter_to_continue
  echo ""
  echo "  Step 3: Enable the APIs."
  echo "  In the left sidebar: APIs & Services -> Library."
  echo "  Search for and enable each of these:"
  echo "    Gmail API"
  echo "    Google Calendar API"
  echo "    Google Drive API"
  echo ""
  press_enter_to_continue
  echo ""
  echo "  Step 4: Create OAuth credentials."
  echo "  APIs & Services -> Credentials -> Create Credentials -> OAuth client ID."
  echo "  - Application type: Desktop app"
  echo "  - Name: Pandoras Box"
  echo "  - Click Create"
  echo "  Download the JSON file and open it. You need the client_id and client_secret."
  echo ""
  prompt_required "Paste your Google OAuth Client ID" GOOGLE_CLIENT_ID
  read -rsp "  Paste your Google OAuth Client Secret (input hidden): " GOOGLE_CLIENT_SECRET
  echo ""
  echo ""

  local base_dir="$INSTALL_PATH/$slug"
  local service_user="${slug}-agent"

  create_service_account "$service_user" "$((500 + company_index))" "$display_name Agent"
  sudo mkdir -p "$base_dir" "$INSTALL_PATH/${slug}-conductor" \
    "$INSTALL_PATH/${slug}-mail" "$INSTALL_PATH/${slug}-calendar" \
    "$INSTALL_PATH/${slug}-files" "$INSTALL_PATH/${slug}-voice" \
    "$INSTALL_PATH/${slug}-voice-call"
  sudo chown -R "${service_user}:staff" "$base_dir" "$INSTALL_PATH/${slug}-"*
  sudo chmod 750 "$base_dir" "$INSTALL_PATH/${slug}-"*

  write_env_file "$base_dir/.env" \
    "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
    "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" \
    "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
    "COMPANY_SLUG=$slug" \
    "COMPANY_NAME=$display_name"

  install_tenant_runtimes "$slug" "$service_user"

  check_pass "Company '$display_name' configured ($slug) with Google Workspace."
  echo ""
  press_enter_to_continue
}
