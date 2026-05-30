# =============================================================================
# setup-website-builder.sh -- Website builder module
# Builds + maintains a simple static website published via FTP/SFTP.
# =============================================================================

run_website_builder_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" || "${PBOX_UNATTENDED_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "Website builder" \
    "Lets your Personal Assistant generate, edit, and publish a static website (Jekyll-style) for your business. The assistant has tools to add pages, update copy, generate banners, and publish via FTP/SFTP to your hosting provider. Useful for keeping a brochure site fresh without going into a CMS. Not a replacement for a real CMS or e-commerce platform." \
    "An FTP / SFTP host (any provider that gives you FTP credentials -- Stackcp, IONOS, GoDaddy, AWS S3, etc.). Domain name (optional but expected)." \
    "Hosting: typically £3-10/month for a basic FTP host. Domain: ~£15/year. The module itself is free." \
    "~5 minutes"

  prompt_yes_no "Set up Website builder?" wb_choice "no"
  if [[ "$wb_choice" != "yes" ]]; then return 0; fi

  echo ""
  prompt_required "Public domain name (e.g. example.com)" WEBSITE_DOMAIN
  prompt_required "FTP host (e.g. ftp.example.co.uk)" WEBSITE_FTP_HOST
  prompt_required "FTP username" WEBSITE_FTP_USER
  read -rsp "  FTP password (hidden): " WEBSITE_FTP_PASSWORD
  echo ""
  prompt_with_default "FTP target directory" "/public_html" WEBSITE_FTP_DIR

  # Validate connection
  info_msg "Testing FTP connection..."
  if command -v curl &>/dev/null; then
    if curl --silent --max-time 10 \
         -u "$WEBSITE_FTP_USER:$WEBSITE_FTP_PASSWORD" \
         "ftp://$WEBSITE_FTP_HOST/" >/dev/null 2>&1; then
      check_pass "FTP login successful."
    else
      warn_msg "FTP test failed. Continue anyway? (Re-test later with curl manually.)"
    fi
  fi

  export WEBSITE_DOMAIN WEBSITE_FTP_HOST WEBSITE_FTP_USER WEBSITE_FTP_PASSWORD WEBSITE_FTP_DIR
  success_msg "Website builder configured."
}
