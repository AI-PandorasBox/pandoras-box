# =============================================================================
# setup-service-provider.sh -- Service provider mode extras
# =============================================================================

run_service_provider_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  section_header "Service provider setup"
  echo "  You are setting up Pandoras Box in service provider mode."
  echo "  This adds tools for managing AI systems on behalf of clients."
  echo ""

  generate_add_client_script
  generate_welcome_pack_template
  generate_pricing_template
  check_pass "Service provider extras installed."
  echo ""
  press_enter_to_continue
}

generate_add_client_script() {
  local scripts_dir="$INSTALL_PATH/scripts"
  sudo mkdir -p "$scripts_dir"

  sudo bash -c "cat > '$scripts_dir/add-tenant.sh'" <<'ADDEOF'
#!/usr/bin/env bash
# pbox-add-client.sh -- Onboard a new client tenant
# Run: sudo bash /opt/pandoras-box/scripts/add-tenant.sh
set -euo pipefail

INSTALL_PATH="/opt/pandoras-box"
source "$INSTALL_PATH/lib/setup-core.sh"
source "$INSTALL_PATH/lib/setup-company.sh"
source "$INSTALL_PATH/lib/setup-modules.sh"

section_header "Add a new client tenant"
echo ""
echo "  This script provisions a new company tenant."
echo "  The existing tenants are not affected."
echo ""

export COMPANY_COUNT=1
export company_index=1
setup_single_company 1

echo ""
success_msg "New client tenant created."
echo "  Remember to:"
echo "  1. Run the MS365 or Google OAuth flow for the new client"
echo "  2. Send the client their welcome pack (see service-provider/welcome-pack-template.md)"
echo "  3. Update your records with the new company slug"
ADDEOF
  sudo chmod 700 "$scripts_dir/add-tenant.sh"
  check_pass "Client onboarding script: $scripts_dir/add-tenant.sh"
}

generate_welcome_pack_template() {
  local sp_dir="$INSTALL_PATH/service-provider"
  sudo mkdir -p "$sp_dir"

  sudo bash -c "cat > '$sp_dir/welcome-pack-template.md'" <<'WPEOF'
# Welcome to Your AI System

[Fill in: client name and company name]

Your AI system is now set up and running. This document tells you everything
you need to know to get started.

## What your system can do

Your system includes an AI assistant that can:

- Check and draft replies to your email on request
- Summarise your calendar and flag upcoming deadlines
- Search your documents for specific information
- Send you a morning briefing of your day

## How to talk to your AI

Send a message to [fill in: the channel you configured, e.g. Telegram or Discord].

Examples of what you can ask:
- "What emails need my attention today?"
- "What is in my diary this week?"
- "Summarise the last email from [name]"
- "What meetings do I have tomorrow?"

## How to access the admin panel

[Fill in: your Tailscale URL, e.g. https://your-server.tailXXXXXX.ts.net:8787]

You will need to install Tailscale on your device first:
- iPhone: App Store -> search Tailscale -> install and sign in
- Android: Play Store -> search Tailscale -> install and sign in

## Getting help

If something is not working, contact: [fill in: your support contact]

For urgent issues: [fill in: your emergency contact]

## Your system details

- Company slug: [fill in]
- Service started: [fill in date]
- Renewal date: [fill in]
WPEOF
  sudo chmod 644 "$sp_dir/welcome-pack-template.md"
  check_pass "Welcome pack template: $sp_dir/welcome-pack-template.md"
}

generate_pricing_template() {
  local sp_dir="$INSTALL_PATH/service-provider"

  sudo bash -c "cat > '$sp_dir/pricing-template.md'" <<'PRICEEOF'
# Pricing Template (Service Provider)

This is a template. Adjust the tiers to match your actual costs and margin.

## Suggested Tiers

### Starter
- 1 company, mail + calendar agents
- Morning briefing
- Standard support
- Suggested price: £X/month

### Professional
- Up to 3 companies
- Mail + calendar + files agents
- Morning briefing + evening summary
- Priority support
- Suggested price: £X/month

### Enterprise
- Unlimited companies
- All modules
- Dedicated onboarding
- SLA-backed support
- Suggested price: £X/month

## Cost to You (per company, approximate)

- Anthropic API: £5-30/month depending on volume
- ElevenLabs (voice, if enabled): £5-10/month
- Microsoft 365 / Google Workspace: your client pays this directly
- Hardware: Mac Mini M4 (approx £700 one-time)

## Notes

- All prices exclude applicable taxes
- API costs are variable -- set Anthropic spend limits per client
- Review and adjust monthly as you learn actual usage
PRICEEOF
  sudo chmod 644 "$sp_dir/pricing-template.md"
  check_pass "Pricing template: $sp_dir/pricing-template.md"
}
