#!/usr/bin/env bash
# install.sh -- media-production social/content pipeline installer
set -euo pipefail

MODULE_NAME="media-production"
TOTAL_STEPS=3

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Configuring publishing platform credentials"
MEDIA_PRODUCTION_DIR="$INSTALL_PATH/media-production"
sudo mkdir -p "$MEDIA_PRODUCTION_DIR/queue"
MEDIA_PRODUCTION_ENV="$MEDIA_PRODUCTION_DIR/.env"
echo ""
echo "  Configure which platforms you want to publish to."
echo "  Press Return to skip any you do not use yet."
echo ""
read -rsp "  LinkedIn OAuth access token (hidden, press Return to skip): " LINKEDIN_TOKEN
echo ""
read -rp "  YouTube channel ID (press Return to skip): " YOUTUBE_CHANNEL_ID
read -rsp "  ElevenLabs API key for voice content (hidden, press Return to skip): " ELEVENLABS_KEY
echo ""

sudo bash -c "cat > '$MEDIA_PRODUCTION_ENV'" <<ENVEOF
MEDIA_PRODUCTION_ENABLED=true
LINKEDIN_ACCESS_TOKEN=${LINKEDIN_TOKEN:-}
YOUTUBE_CHANNEL_ID=${YOUTUBE_CHANNEL_ID:-}
ELEVENLABS_API_KEY=${ELEVENLABS_KEY:-}
CONTENT_QUEUE_DIR=$MEDIA_PRODUCTION_DIR/queue
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' "$INSTALL_PATH/muse/.env" 2>/dev/null | cut -d= -f2 || echo "")
ENVEOF
sudo chmod 600 "$MEDIA_PRODUCTION_ENV"
ok "the Media Production Pipeline config written"

step 2 "Creating content queue"
QUEUE_FILE="$MEDIA_PRODUCTION_DIR/queue/pending.json"
if [[ ! -f "$QUEUE_FILE" ]]; then
  sudo bash -c "echo '[]' > '$QUEUE_FILE'"
  ok "Empty content queue created"
fi

step 3 "Enabling in Personal AI config"
MUSE_ENV="$INSTALL_PATH/muse/.env"
sudo sed -i'' '/^MEDIA_PRODUCTION_ENABLED=/d' "$MUSE_ENV" 2>/dev/null || true
sudo bash -c "echo 'MEDIA_PRODUCTION_ENABLED=true' >> '$MUSE_ENV'"
sudo launchctl stop "${LAUNCHDAEMON_PREFIX}.muse" 2>/dev/null || true
sleep 1
sudo launchctl start "${LAUNCHDAEMON_PREFIX}.muse" 2>/dev/null || true
ok "Personal AI updated and restarted"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Ask your Personal Assistant: 'Draft a LinkedIn post about [topic]'"
echo "  All content goes through your approval queue before publishing."
