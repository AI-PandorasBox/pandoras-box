#!/usr/bin/env bash
# install.sh -- ollama module installer
# Installs the upstream `ollama` binary via Homebrew, pulls the default model,
# loads ollama's own LaunchAgent (managed by brew). No bespoke runtime; this
# module is a wrapper that ensures ollama is ready for the Personal AI to
# call locally instead of paying frontier API costs for routine classification.
set -euo pipefail

MODULE_NAME="ollama"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* helpers

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }
fail() { echo "[$MODULE_NAME] FAIL: $1"; exit 1; }

OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:12b}"

step 1 "Installing ollama (if needed)"
if command -v ollama >/dev/null 2>&1; then
  ok "ollama already installed: $(ollama --version 2>&1 | head -1)"
elif [[ "$PBOX_OS" == Darwin ]]; then
  command -v brew &>/dev/null || fail "Homebrew not found (install from https://brew.sh, then re-run)"
  brew install ollama || fail "brew install ollama failed"
  ok "ollama installed via Homebrew"
else
  echo "  Downloading the official ollama installer (https://ollama.com/install.sh)..."
  curl -fsSL https://ollama.com/install.sh | sh || fail "ollama install script failed (see https://ollama.com/download for manual install)"
  ok "ollama installed via official Linux installer"
fi

step 2 "Starting ollama service"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) ollama service start skipped"
elif [[ "$PBOX_OS" == Darwin ]]; then
  brew services start ollama 2>&1 | head -3 || true
  ok "ollama service started"
else
  sudo systemctl enable --now ollama 2>&1 | head -3 || true
  ok "ollama service started"
fi

step 3 "Verifying ollama is reachable"
sleep 2
if curl -s -o /dev/null --max-time 6 http://127.0.0.1:11434/ 2>/dev/null; then
  ok "ollama responding on http://127.0.0.1:11434/"
else
  warn_msg "ollama did not respond on :11434 yet (may still be starting; check 'systemctl status ollama' or 'brew services list')"
fi

step 4 "Pulling default model: $OLLAMA_MODEL"
echo "  (this takes a few minutes for the first run)"
if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
  ok "(dry-run) ollama pull $OLLAMA_MODEL skipped"
else
  ollama pull "$OLLAMA_MODEL" 2>&1 | tail -3 || fail "model pull failed"
  ok "Model $OLLAMA_MODEL pulled"
fi

# Marker file so other modules can detect ollama-ready
sudo mkdir -p "$INSTALL_PATH/ollama"
sudo bash -c "echo OLLAMA_MODEL=$OLLAMA_MODEL > '$INSTALL_PATH/ollama/.env'"
sudo bash -c "echo OLLAMA_HOST=http://127.0.0.1:11434 >> '$INSTALL_PATH/ollama/.env'"
sudo chmod 600 "$INSTALL_PATH/ollama/.env"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Endpoint: http://127.0.0.1:11434"
echo "  Default model: $OLLAMA_MODEL"
exit 0
