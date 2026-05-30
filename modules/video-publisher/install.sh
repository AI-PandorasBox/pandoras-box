#!/usr/bin/env bash
# install.sh -- video-publisher module installer
set -euo pipefail

MODULE_NAME="video-publisher"
TOTAL_STEPS=5

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf
source ${INSTALL_PATH:-/opt/pandoras-box}/lib/os-compat.sh   # PBOX_OS + pbox_* portability helpers

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Checking ffmpeg"
if ! command -v ffmpeg &>/dev/null; then
  echo "  Installing ffmpeg..."
  pbox_install_pkg ffmpeg || { echo "FAIL: Could not install ffmpeg."; exit 1; }
fi
ok "ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -c1-50)"

step 2 "Collecting ElevenLabs credentials"
echo ""
echo "  ElevenLabs is used for voice synthesis in video production."
read -rsp "  ElevenLabs API key (hidden): " ELEVEN_KEY
echo ""
read -rp "  ElevenLabs voice ID for narration: " ELEVEN_VOICE_ID

step 3 "Collecting YouTube credentials"
echo ""
echo "  To publish to YouTube, you need YouTube Data API v3 credentials."
echo "  1. Go to console.cloud.google.com"
echo "  2. Create a project (or use an existing one)"
echo "  3. Enable YouTube Data API v3"
echo "  4. Create OAuth 2.0 Desktop credentials"
echo "  5. Note your client ID and secret"
echo ""
read -rp "  YouTube OAuth Client ID: " YT_CLIENT_ID
read -rsp "  YouTube OAuth Client Secret (hidden): " YT_CLIENT_SECRET
echo ""
read -rp "  YouTube Channel ID: " YT_CHANNEL_ID

step 4 "Writing config"
VIDEO_DIR="$INSTALL_PATH/video-publisher"
sudo mkdir -p "$VIDEO_DIR/output" "$VIDEO_DIR/queue"
VIDEO_ENV="$VIDEO_DIR/.env"
sudo bash -c "cat > '$VIDEO_ENV'" <<ENVEOF
VIDEO_PUBLISHER_ENABLED=true
ELEVENLABS_API_KEY=$ELEVEN_KEY
ELEVENLABS_VOICE_ID=$ELEVEN_VOICE_ID
YOUTUBE_CLIENT_ID=$YT_CLIENT_ID
YOUTUBE_CLIENT_SECRET=$YT_CLIENT_SECRET
YOUTUBE_CHANNEL_ID=$YT_CHANNEL_ID
VIDEO_OUTPUT_DIR=$VIDEO_DIR/output
VIDEO_QUEUE_DIR=$VIDEO_DIR/queue
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' "$INSTALL_PATH/personal-ai/.env" 2>/dev/null | cut -d= -f2 || echo "")
ENVEOF
sudo chmod 600 "$VIDEO_ENV"
ok "Video publisher config written"

step 5 "Running YouTube OAuth flow"
echo ""
echo "  Starting YouTube OAuth flow..."
echo "  A browser window will open. Sign in with the YouTube channel account."
echo "  Press Return to start..."
read -r
echo "  (OAuth flow runs on first video publish request. The conductor will open"
echo "   a browser window automatically when needed.)"
ok "YouTube auth will complete on first use"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  Video publisher installed."
echo "  Ask your Personal Assistant: 'Create a video about [topic]'"
echo "  Output: $VIDEO_DIR/output/"
