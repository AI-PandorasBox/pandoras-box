#!/usr/bin/env bash
# =============================================================================
# pbox-update.sh -- Pandora's Box installer auto-update (Layer 1 of 4).
#
# Layer 1 ships:
#   pbox-update --check-only [--quiet]
#     Reads $INSTALL_PATH/VERSION (the anchor written at install time)
#     and compares against the latest published GitHub Release tag.
#     Prints a one-line summary or "up to date". No side effects.
#
# Layer 2 (full upgrade) is NOT yet wired -- this script will tell you a
# new release is available but will not download or apply it.
#
# Authentication:
#   - If PBOX_GITHUB_TOKEN is set in the environment, OR ~/.config/pandoras-box/github-token
#     exists, the request to api.github.com is authenticated.
#     (Useful pre-public-flip when the repo is still private; unnecessary post-flip.)
#   - Otherwise unauthenticated. Public-repo only.
# =============================================================================

set -euo pipefail

REPO="${PBOX_REPO:-AI-PandorasBox/pandoras-box}"
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
VERSION_FILE="$INSTALL_PATH/VERSION"
STATUS_FILE="$INSTALL_PATH/.update-status.json"
QUIET=0
CHECK_ONLY=0

# CLI parsing
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)  CHECK_ONLY=1; shift ;;
    --quiet|-q)    QUIET=1; shift ;;
    --help|-h)
      cat <<USAGE
pbox-update -- Pandora's Box update helper

Usage:
  pbox-update --check-only [--quiet]    Check for a newer release, no side effects.
  pbox-update --help                    Show this help.

Layer 2 (full upgrade flow) is not yet shipped; this script can only report
whether a new release is available. The Layer 2 'pbox-update' command will
land in a subsequent release.

Env:
  INSTALL_PATH         Where Pandora's Box is installed (default /opt/pandoras-box).
  PBOX_REPO            Override the source repo (default AI-PandorasBox/pandoras-box).
  PBOX_GITHUB_TOKEN    Optional bearer token for authenticated API access.
USAGE
      exit 0 ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [[ $CHECK_ONLY -ne 1 ]]; then
  echo "pbox-update: only --check-only is implemented in this release." >&2
  echo "             Run with --check-only to see if a new release is available." >&2
  exit 2
fi

# Load auth token if available
TOKEN=""
if [[ -n "${PBOX_GITHUB_TOKEN:-}" ]]; then
  TOKEN="$PBOX_GITHUB_TOKEN"
elif [[ -f "$HOME/.config/pandoras-box/github-token" ]]; then
  TOKEN="$(tr -d '[:space:]' < "$HOME/.config/pandoras-box/github-token")"
fi

# Read current version
CURRENT="v0.0.0-dev"
if [[ -f "$VERSION_FILE" ]]; then
  CURRENT="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi

# Fetch latest release
API_URL="https://api.github.com/repos/$REPO/releases/latest"
CURL_ARGS=( -fsSL -H "Accept: application/vnd.github+json" )
[[ -n "$TOKEN" ]] && CURL_ARGS+=( -H "Authorization: Bearer $TOKEN" )

# Use grep + sed instead of jq so we have zero dependency footprint on the
# operator's machine. Only the tag_name + published_at fields are needed.
RESPONSE="$(curl "${CURL_ARGS[@]}" "$API_URL" 2>/dev/null || true)"

LATEST=""
PUBLISHED=""
if [[ -n "$RESPONSE" ]]; then
  LATEST="$(printf '%s\n' "$RESPONSE" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  PUBLISHED="$(printf '%s\n' "$RESPONSE" | grep -m1 '"published_at"' | sed -E 's/.*"published_at"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

# Persist status (operator dashboard or Layer 3 cron reads this)
TMP_STATUS="$(mktemp)"
cat > "$TMP_STATUS" <<JSON
{
  "current_version": "$CURRENT",
  "latest_version":  "${LATEST:-unknown}",
  "released_at":     "${PUBLISHED:-unknown}",
  "checked_at":      "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo":            "$REPO",
  "authenticated":   $([[ -n "$TOKEN" ]] && echo true || echo false)
}
JSON

# Write status file (sudo if needed)
if [[ -w "$INSTALL_PATH" ]] || [[ -w "$STATUS_FILE" ]] 2>/dev/null; then
  mv "$TMP_STATUS" "$STATUS_FILE"
else
  sudo mv "$TMP_STATUS" "$STATUS_FILE" 2>/dev/null || rm -f "$TMP_STATUS"
fi

# Decide message + exit code
if [[ -z "$LATEST" ]]; then
  if [[ $QUIET -eq 1 ]]; then
    exit 1
  fi
  if [[ -n "$TOKEN" ]]; then
    echo "pbox-update: could not reach $API_URL (network or token issue)." >&2
  else
    echo "pbox-update: could not reach $API_URL." >&2
    echo "             If the repo is still private, set PBOX_GITHUB_TOKEN." >&2
  fi
  exit 1
fi

if [[ "$CURRENT" == "$LATEST" ]]; then
  [[ $QUIET -eq 1 ]] || echo "up to date ($CURRENT)"
  exit 0
fi

# Anchor-known dev installs (VERSION=v0.0.0-dev) should not nag the operator
# about every release; just report and exit 0.
if [[ "$CURRENT" == "v0.0.0-dev" ]]; then
  [[ $QUIET -eq 1 ]] || echo "dev install (no VERSION anchor); latest published release is $LATEST (released ${PUBLISHED:-unknown})"
  exit 0
fi

# An update is available
if [[ $QUIET -eq 1 ]]; then
  exit 10
fi
echo "current=$CURRENT, latest=$LATEST (released ${PUBLISHED:-unknown})."
echo "Run 'pbox-update' to apply when Layer 2 ships. For now, follow the release notes at"
echo "  https://github.com/$REPO/releases/tag/$LATEST"
exit 10
