#!/usr/bin/env bash
# install.sh -- offline-kb knowledge RAG module installer
set -euo pipefail

MODULE_NAME="offline-kb"
TOTAL_STEPS=4

[[ -f ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf ]] || { echo "ERROR: Run pbox-setup.sh first."; exit 1; }
source ${INSTALL_PATH:-/opt/pandoras-box}/theme.conf

step() { echo "[$MODULE_NAME] step $1/$TOTAL_STEPS: $2"; }
ok()   { echo "[$MODULE_NAME] OK: $1"; }

step 1 "Checking Qdrant"
QDRANT_HOST="${QDRANT_HOST:-http://localhost:6333}"
if curl -sf "$QDRANT_HOST/health" >/dev/null 2>&1; then
  ok "Qdrant is running at $QDRANT_HOST"
else
  echo "  Qdrant is not running. Attempting to install via Docker..."
  if command -v docker &>/dev/null; then
    docker run -d --name qdrant -p 6333:6333 \
      -v "$HOME/.qdrant:/qdrant/storage" \
      qdrant/qdrant:latest >/dev/null 2>&1 && ok "Qdrant started via Docker" || {
      echo "FAIL: Could not start Qdrant."
      echo "  Start manually: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant"
      echo "  Or install Qdrant locally: https://qdrant.tech/documentation/quick-start/"
      exit 1
    }
  else
    echo "FAIL: Qdrant is not running and Docker is not available."
    echo "  Install Docker Desktop from https://docker.com or Qdrant natively."
    exit 1
  fi
fi

step 2 "Creating Qdrant collection"
COLLECTION_NAME="${OFFLINE_KB_COLLECTION:-pandoras-box-knowledge}"
curl -sf -X PUT "$QDRANT_HOST/collections/$COLLECTION_NAME" \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 1536, "distance": "Cosine"}}' >/dev/null 2>&1 && \
  ok "Collection '$COLLECTION_NAME' ready" || \
  ok "Collection '$COLLECTION_NAME' may already exist -- continuing"

step 3 "Configuring the Offline Knowledge Library environment"
OFFLINE_KB_DIR="$INSTALL_PATH/offline-kb"
sudo mkdir -p "$OFFLINE_KB_DIR/docs"
OFFLINE_KB_ENV="$OFFLINE_KB_DIR/.env"
sudo bash -c "cat > '$OFFLINE_KB_ENV'" <<ENVEOF
OFFLINE_KB_ENABLED=true
QDRANT_HOST=$QDRANT_HOST
OFFLINE_KB_COLLECTION=$COLLECTION_NAME
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' "$INSTALL_PATH/muse/.env" 2>/dev/null | cut -d= -f2 || echo "")
ENVEOF
sudo chmod 600 "$OFFLINE_KB_ENV"
ok "the Offline Knowledge Library config written"

step 4 "Initial knowledge index"
echo ""
echo "  the Offline Knowledge Library is ready to index documents."
echo "  Place documents in: $OFFLINE_KB_DIR/docs/"
echo "  Supported formats: .txt, .md, .pdf"
echo ""
echo "  To index immediately:"
echo "  node /opt/pandoras-box/offline-kb/index.mjs"
echo ""
echo "  Or ask your Personal Assistant: 'Index my knowledge documents'"

echo ""
echo "[$MODULE_NAME] PASS"
echo "  the Offline Knowledge Library RAG module installed. Qdrant collection: $COLLECTION_NAME"
