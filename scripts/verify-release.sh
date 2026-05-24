#!/usr/bin/env bash
# Verify a Pandora's Box release: SSH signature over SHA256SUMS, then the checksums.
set -euo pipefail
DIR="${1:-.}"; cd "$DIR"
SIGNER="${PBOX_SIGNER:-zeus@ai-pandorasbox.co.uk}"
SIGNERS="$(cd "$(dirname "$0")" && pwd)/allowed_signers"
ssh-keygen -Y verify -f "$SIGNERS" -I "$SIGNER" -n pbox-release -s SHA256SUMS.sig < SHA256SUMS
shasum -a 256 -c SHA256SUMS
echo "Release verified."
