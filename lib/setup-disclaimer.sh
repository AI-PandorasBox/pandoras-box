# =============================================================================
# setup-disclaimer.sh -- Mandatory no-liability disclaimer gate.
# Shown immediately after the welcome banner, before any system change.
# User MUST type "yes" to proceed. Any other input exits with code 0.
# =============================================================================

DISCLAIMER_ACK_FILE="${INSTALL_PATH:-/opt/pandoras-box}/.disclaimer-acknowledged"

run_disclaimer_gate() {
  # In dry-run mode, auto-acknowledge so the installer can run end-to-end
  # in CI / sandbox without blocking on the read prompt.
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "Disclaimer auto-acknowledged (PBOX_DRY_RUN=1)."
    mkdir -p "$(dirname "$DISCLAIMER_ACK_FILE")"
    echo "acknowledged_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"  > "$DISCLAIMER_ACK_FILE"
    echo "by_user=$(whoami) (dry-run)"                    >> "$DISCLAIMER_ACK_FILE"
    return 0
  fi

  # Skip if already acknowledged on a previous install attempt.
  if [[ -f "$DISCLAIMER_ACK_FILE" ]]; then
    info_msg "Disclaimer was already acknowledged -- skipping."
    return 0
  fi

  clear
  echo ""
  echo "  ${C_BOLD}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
  echo "  ${C_BOLD}║                                                                  ║${C_RESET}"
  echo "  ${C_BOLD}║   IMPORTANT -- Please read before installing                     ║${C_RESET}"
  echo "  ${C_BOLD}║                                                                  ║${C_RESET}"
  echo "  ${C_BOLD}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
  echo ""
  echo "  Pandoras Box is open-source software released under the Apache 2.0 licence"
  echo "  (see LICENSE in this repository). The Apache 2.0 licence covers the code."
  echo ""
  echo "  This installer is asking you to acknowledge how the system actually"
  echo "  ${C_BOLD}operates${C_RESET} on your behalf, in addition to the code licence:"
  echo ""
  echo "  ${C_BOLD}1. AI agents take real-world actions.${C_RESET}"
  echo "     Once installed, these agents will read your email, write replies,"
  echo "     create calendar events, save files, post to social media, and (if"
  echo "     you enable trading) place orders with your broker. They make their"
  echo "     own decisions inside the boundaries you configure."
  echo ""
  echo "  ${C_BOLD}2. You are responsible for what they do.${C_RESET}"
  echo "     The authors of this software are not responsible for emails sent,"
  echo "     meetings booked, files written, money lost, posts published, or"
  echo "     any other action taken by an agent running on your machine. You"
  echo "     are the operator. Configure the spend caps. Review approvals."
  echo "     Watch the audit log."
  echo ""
  echo "  ${C_BOLD}3. Third-party costs are yours.${C_RESET}"
  echo "     The system uses paid services (Anthropic, Google AI, ElevenLabs,"
  echo "     and others, depending on which modules you install). Each module"
  echo "     screen explains the expected costs before install. Subscription"
  echo "     and usage charges are billed to the accounts you connect."
  echo ""
  echo "  ${C_BOLD}4. Pre-release software, no support guarantees.${C_RESET}"
  echo "     This is provided AS IS, with no warranty of fitness for any"
  echo "     particular purpose. There is no support contract. Best-effort"
  echo "     community help is available via GitHub Issues -- nothing more."
  echo ""
  echo "  ${C_BOLD}5. No financial, legal, medical, or professional advice.${C_RESET}"
  echo "     Trading signals (the Trading Research Agent module) are not financial advice. Drafted"
  echo "     emails are not legal advice. Briefings are not medical advice."
  echo "     Use professional judgement on anything that matters."
  echo ""
  echo "  ${C_BOLD}6. Data on your machine, your responsibility.${C_RESET}"
  echo "     Pandoras Box runs locally and stores data on this machine. Backup,"
  echo "     encryption, physical security, and OS account hygiene are your"
  echo "     responsibility. The optional backups module helps with the first."
  echo ""
  echo "  ${C_BOLD}── Acknowledgement required ──${C_RESET}"
  echo ""
  echo "  Type ${C_BOLD}yes${C_RESET} (lowercase, the full word) to acknowledge that you have"
  echo "  read the above and accept these terms. Anything else exits the"
  echo "  installer without making any changes."
  echo ""

  local ack=""
  read -rp "  I have read and accept these terms: " ack

  if [[ "$ack" != "yes" ]]; then
    echo ""
    info_msg "Acknowledgement not given. Installer exiting without making any changes."
    echo ""
    exit 0
  fi

  # Record acknowledgement so re-runs don't re-prompt.
  sudo mkdir -p "$(dirname "$DISCLAIMER_ACK_FILE")"
  sudo bash -c "echo \"acknowledged_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > '$DISCLAIMER_ACK_FILE'"
  sudo bash -c "echo \"by_user=$(whoami)\" >> '$DISCLAIMER_ACK_FILE'"
  sudo chmod 644 "$DISCLAIMER_ACK_FILE"

  echo ""
  success_msg "Acknowledged. Proceeding with install."
  echo ""
  press_enter_to_continue
}
