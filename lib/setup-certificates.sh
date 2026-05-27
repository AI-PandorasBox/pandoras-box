# =============================================================================
# setup-certificates.sh -- CA generation and certificate installation guide
# =============================================================================

CERT_DIR="$INSTALL_PATH/certs"

run_certificate_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  section_header "Setting up secure connections (certificates)"
  echo "  Your browser needs a certificate to connect to Pandoras Box over HTTPS."
  echo ""
  echo "  What is a certificate?"
  echo "  A certificate is a small file that proves your connection is encrypted"
  echo "  and that you are connecting to your own system -- not an imposter site."
  echo "  Your browser refuses to load some features (like microphone access)"
  echo "  without it."
  echo ""
  echo "  What we are about to do:"
  echo "  1. Generate a private Certificate Authority (CA) on this Mac"
  echo "     (a CA is like a trusted authority that signs the certificate)"
  echo "  2. Generate a server certificate signed by that CA"
  echo "  3. Install the CA certificate on this Mac automatically"
  echo "  4. Copy the CA certificate to your Desktop so you can install it"
  echo "     on your other devices"
  echo ""
  press_enter_to_continue

  sudo mkdir -p "$CERT_DIR"
  sudo chmod 700 "$CERT_DIR"

  local hostname="${TAILSCALE_HOSTNAME:-pandoras-box.local}"
  local ca_key="$CERT_DIR/ca.key"
  local ca_cert="$CERT_DIR/ca.crt"
  local server_key="$CERT_DIR/server.key"
  local server_cert="$CERT_DIR/server.crt"

  echo "  Generating your Certificate Authority..."
  sudo openssl genrsa -out "$ca_key" 4096 2>/dev/null
  sudo openssl req -new -x509 -days 3650 -key "$ca_key" \
    -out "$ca_cert" \
    -subj "/CN=Pandoras Box CA/O=Pandoras Box/C=GB" 2>/dev/null
  check_pass "Certificate Authority generated."

  echo "  Generating your server certificate..."
  sudo openssl genrsa -out "$server_key" 2048 2>/dev/null
  sudo openssl req -new -key "$server_key" \
    -out "$CERT_DIR/server.csr" \
    -subj "/CN=$hostname/O=Pandoras Box/C=GB" 2>/dev/null

  # SAN extension file
  sudo bash -c "cat > '$CERT_DIR/san.ext'" <<SANEOF
[SAN]
subjectAltName=DNS:$hostname,DNS:localhost,IP:127.0.0.1
SANEOF

  sudo openssl x509 -req -days 3650 \
    -in "$CERT_DIR/server.csr" \
    -CA "$ca_cert" -CAkey "$ca_key" -CAcreateserial \
    -out "$server_cert" \
    -extfile "$CERT_DIR/san.ext" -extensions SAN 2>/dev/null
  check_pass "Server certificate generated for: $hostname"

  echo ""
  echo "  Installing the CA certificate on this machine..."
  pbox_trust_ca "$ca_cert" 2>/dev/null
  check_pass "CA certificate installed and trusted on this machine."

  echo ""
  echo "  Copying CA certificate to your Desktop..."
  local desktop_cert="$HOME/Desktop/PandorasBox-CA.crt"
  cp "$ca_cert" "$desktop_cert"
  chmod 644 "$desktop_cert"
  success_msg "CA certificate saved to: $desktop_cert"
  echo ""
  echo "  You need to install this file on every other device that will access"
  echo "  your system (phone, iPad, other Mac, etc.)."
  echo ""
  echo "  Full installation guide for each device type: docs/certificates.md"
  echo ""

  # Write a renewal script. The "restart your services" hint is OS-aware so it
  # reflects the platform this install is running on (launchctl vs systemctl).
  local renew_restart_hint
  if [[ "$PBOX_OS" == Darwin ]]; then
    renew_restart_hint="  sudo launchctl stop com.pandoras-box.personal-ai && sudo launchctl start com.pandoras-box.personal-ai"
  else
    renew_restart_hint="  sudo systemctl restart pbox-personal-ai"
  fi
  sudo bash -c "cat > '$INSTALL_PATH/pbox-renew-cert.sh'" <<RENEWEOF
#!/usr/bin/env bash
# Renew the Pandoras Box server certificate
# Run this if you see certificate expiry errors
set -e
cd "$CERT_DIR"
echo "Renewing server certificate..."
openssl x509 -req -days 3650 \
  -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt \
  -extfile san.ext -extensions SAN 2>/dev/null
echo "Done. Restart your services for the new certificate to take effect."
echo "$renew_restart_hint"
RENEWEOF
  sudo chmod 700 "$INSTALL_PATH/pbox-renew-cert.sh"
  check_pass "Certificate renewal script created: $INSTALL_PATH/pbox-renew-cert.sh"

  press_enter_to_continue
}
