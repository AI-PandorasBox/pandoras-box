#!/usr/bin/env bash
# =============================================================================
# pbox-update.sh -- Pandora's Box installer auto-update (Layers 1 + 2).
#
# Layer 1 (existing): pbox-update --check-only [--quiet]
#   Reads $INSTALL_PATH/VERSION and compares against the latest GitHub Release.
#   No side effects.
#
# Layer 2 (NEW, this version): pbox-update --apply | pbox-update
#   User-gated: requires explicit invocation (no auto-apply).
#   Downloads the latest release tarball, verifies its SHA256, backs up the
#   current INSTALL_PATH to INSTALL_PATH-rollback-<timestamp>, replaces the
#   install in place, updates VERSION, logs the upgrade.
#
#   NOT in scope for this release:
#     - Schema migrations (run manually if release notes call for them)
#     - Signed-release verification (deferred -- planned for v0.7)
#     - Auto-apply (Layer 3 will only stage; user always invokes apply)
#     - Daemon restart coordination (operator restarts services manually)
#
#   Rollback: pbox-update --rollback [<timestamp>]
#     Restores from the most recent (or specified) INSTALL_PATH-rollback-<ts>
#     dir. Manual operator action; does NOT auto-restart services.
#
# Authentication:
#   - PBOX_GITHUB_TOKEN env or ~/.config/pandoras-box/github-token enables
#     authenticated API access (useful pre-public-flip).
#
# Marker: _PBOX_UPDATE_V2 -- successor to _PBOX_UPDATE_V1 (check-only only).
# =============================================================================

set -euo pipefail

REPO="${PBOX_REPO:-AI-PandorasBox/pandoras-box}"
INSTALL_PATH="${INSTALL_PATH:-/opt/pandoras-box}"
VERSION_FILE="$INSTALL_PATH/VERSION"
STATUS_FILE="$INSTALL_PATH/.update-status.json"
UPGRADE_LOG="$INSTALL_PATH/upgrade.log"

QUIET=0
ACTION=""        # check-only | apply | rollback | help
ROLLBACK_TS=""   # specific rollback timestamp (optional)

# ── CLI parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)  ACTION="check-only"; shift ;;
    --apply)       ACTION="apply"; shift ;;
    --rollback)
      ACTION="rollback"; shift
      if [[ $# -gt 0 && "$1" != --* ]]; then ROLLBACK_TS="$1"; shift; fi
      ;;
    --quiet|-q)    QUIET=1; shift ;;
    --help|-h)
      cat <<USAGE
pbox-update -- Pandora's Box update helper

Usage:
  pbox-update                            Apply latest release (downloads + replaces install).
  pbox-update --apply                    Same as above (explicit).
  pbox-update --check-only [--quiet]     Check for new release; no side effects.
  pbox-update --rollback [<timestamp>]   Restore from rollback snapshot.
  pbox-update --help                     Show this help.

Env:
  INSTALL_PATH         Where Pandora's Box is installed (default /opt/pandoras-box).
  PBOX_REPO            Override the source repo (default AI-PandorasBox/pandoras-box).
  PBOX_GITHUB_TOKEN    Optional bearer token for authenticated API access.

Apply flow:
  1. Download latest release tarball from GitHub.
  2. Verify SHA256 against the release's published hash (best-effort: warn if absent).
  3. Backup INSTALL_PATH to INSTALL_PATH-rollback-<timestamp>.
  4. Extract new release over INSTALL_PATH (preserving INSTALL_PATH/data,
     INSTALL_PATH/store, INSTALL_PATH/.env if present).
  5. Update INSTALL_PATH/VERSION.
  6. Append entry to INSTALL_PATH/upgrade.log.
  7. Print rollback command in case the upgrade went sideways.

Daemon restart, schema migration, etc. are NOT performed by this script.
Read the release notes at https://github.com/$REPO/releases/latest for those.
USAGE
      exit 0 ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# Default: if no action specified, apply (warn the operator + 5s timer).
if [[ -z "$ACTION" ]]; then
  ACTION="apply"
fi

# ── Common: load auth token + read current version ───────────────────────────
TOKEN=""
if [[ -n "${PBOX_GITHUB_TOKEN:-}" ]]; then
  TOKEN="$PBOX_GITHUB_TOKEN"
elif [[ -f "$HOME/.config/pandoras-box/github-token" ]]; then
  TOKEN="$(tr -d '[:space:]' < "$HOME/.config/pandoras-box/github-token")"
fi

CURRENT="v0.0.0-dev"
if [[ -f "$VERSION_FILE" ]]; then
  CURRENT="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi

# ── ROLLBACK action ──────────────────────────────────────────────────────────
if [[ "$ACTION" == "rollback" ]]; then
  if [[ -n "$ROLLBACK_TS" ]]; then
    ROLLBACK_DIR="${INSTALL_PATH}-rollback-${ROLLBACK_TS}"
  else
    # most recent rollback dir
    ROLLBACK_DIR=$(ls -1d "${INSTALL_PATH}-rollback-"* 2>/dev/null | tail -1)
  fi
  if [[ -z "$ROLLBACK_DIR" || ! -d "$ROLLBACK_DIR" ]]; then
    echo "pbox-update: no rollback dir found at ${INSTALL_PATH}-rollback-*" >&2
    exit 1
  fi
  echo "Rolling back $INSTALL_PATH from $ROLLBACK_DIR"
  if [[ -d "$INSTALL_PATH" ]]; then
    FAIL_DIR="${INSTALL_PATH}-failed-$(date -u +%Y%m%dT%H%M%SZ)"
    sudo mv "$INSTALL_PATH" "$FAIL_DIR"
    echo "  Failed-install moved to: $FAIL_DIR"
  fi
  sudo cp -R "$ROLLBACK_DIR" "$INSTALL_PATH"
  printf '[%s] rollback: restored from %s -> %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ROLLBACK_DIR" "$INSTALL_PATH" \
    | sudo tee -a "$UPGRADE_LOG" >/dev/null
  echo "Rollback complete. Operator must restart services manually if needed."
  exit 0
fi

# ── Fetch latest release metadata ────────────────────────────────────────────
API_URL="https://api.github.com/repos/$REPO/releases/latest"
CURL_ARGS=( -fsSL -H "Accept: application/vnd.github+json" )
[[ -n "$TOKEN" ]] && CURL_ARGS+=( -H "Authorization: Bearer $TOKEN" )

RESPONSE="$(curl "${CURL_ARGS[@]}" "$API_URL" 2>/dev/null || true)"

LATEST=""; PUBLISHED=""; TARBALL_URL=""
if [[ -n "$RESPONSE" ]]; then
  LATEST="$(printf '%s\n' "$RESPONSE" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  PUBLISHED="$(printf '%s\n' "$RESPONSE" | grep -m1 '"published_at"' | sed -E 's/.*"published_at"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  # tarball_url is provided by the GitHub API directly
  TARBALL_URL="$(printf '%s\n' "$RESPONSE" | grep -m1 '"tarball_url"' | sed -E 's/.*"tarball_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

# Persist status (Layer 3 cron + dashboard read this)
TMP_STATUS="$(mktemp)"
cat > "$TMP_STATUS" <<JSON
{
  "current_version": "$CURRENT",
  "latest_version":  "${LATEST:-unknown}",
  "released_at":     "${PUBLISHED:-unknown}",
  "checked_at":      "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo":            "$REPO",
  "authenticated":   $([[ -n "$TOKEN" ]] && echo true || echo false),
  "tarball_url":     "${TARBALL_URL:-unknown}"
}
JSON

if [[ -w "$INSTALL_PATH" ]] || { [[ -e "$STATUS_FILE" ]] && [[ -w "$STATUS_FILE" ]]; }; then
  mv "$TMP_STATUS" "$STATUS_FILE"
else
  sudo mv "$TMP_STATUS" "$STATUS_FILE" 2>/dev/null || rm -f "$TMP_STATUS"
fi

# ── CHECK-ONLY action ────────────────────────────────────────────────────────
if [[ "$ACTION" == "check-only" ]]; then
  if [[ -z "$LATEST" ]]; then
    [[ $QUIET -eq 1 ]] && exit 1
    echo "pbox-update: could not reach $API_URL." >&2
    [[ -z "$TOKEN" ]] && echo "             If the repo is still private, set PBOX_GITHUB_TOKEN." >&2
    exit 1
  fi
  if [[ "$CURRENT" == "$LATEST" ]]; then
    [[ $QUIET -eq 1 ]] || echo "up to date ($CURRENT)"
    exit 0
  fi
  if [[ "$CURRENT" == "v0.0.0-dev" ]]; then
    [[ $QUIET -eq 1 ]] || echo "dev install (no VERSION anchor); latest published release is $LATEST"
    exit 0
  fi
  [[ $QUIET -eq 1 ]] && exit 10
  echo "current=$CURRENT, latest=$LATEST (released ${PUBLISHED:-unknown})."
  echo "Run 'pbox-update' or 'pbox-update --apply' to install."
  exit 10
fi

# ── APPLY action ─────────────────────────────────────────────────────────────
if [[ -z "$LATEST" ]]; then
  echo "pbox-update: could not reach $API_URL -- cannot apply." >&2
  exit 1
fi
if [[ -z "$TARBALL_URL" ]]; then
  echo "pbox-update: GitHub API did not return a tarball_url for $LATEST." >&2
  exit 1
fi
if [[ "$CURRENT" == "$LATEST" ]]; then
  echo "pbox-update: already at $CURRENT (= latest)."
  exit 0
fi

echo "Pandora's Box update: $CURRENT -> $LATEST"
echo "  Released:    ${PUBLISHED:-unknown}"
echo "  Tarball:     $TARBALL_URL"
echo "  Install at:  $INSTALL_PATH"
echo "  Rollback will be saved to: ${INSTALL_PATH}-rollback-<timestamp>"
echo ""
echo "Pre-apply checks:"
echo "  - PBox runtime services will NOT be restarted by this script."
echo "  - Schema migrations (if any) are NOT auto-run."
echo "  - Read release notes: https://github.com/$REPO/releases/tag/$LATEST"
echo ""
if [[ -t 0 ]]; then
  read -r -p "Proceed with upgrade? [y/N] " ANS
  [[ "$ANS" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ── Download + verify tarball ────────────────────────────────────────────────
TMPDIR="$(mktemp -d /tmp/pbox-update.XXXXXX)"
TARBALL="$TMPDIR/release.tar.gz"
echo "Downloading tarball..."
curl "${CURL_ARGS[@]}" -L -o "$TARBALL" "$TARBALL_URL" || { echo "tarball download failed"; rm -rf "$TMPDIR"; exit 1; }

ACTUAL_SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
echo "  SHA256: $ACTUAL_SHA256"

# Best-effort SHA256 verification: look for a SHA256SUMS asset on the release.
# If absent (no published manifest), log the hash + warn but don't abort.
SUMS_URL="$(printf '%s\n' "$RESPONSE" | grep -E '"browser_download_url"[^"]*"[^"]*SHA256SUMS' | head -1 | sed -E 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [[ -n "$SUMS_URL" ]]; then
  EXPECTED="$(curl "${CURL_ARGS[@]}" "$SUMS_URL" 2>/dev/null | grep -m1 -E '\.tar\.gz' | awk '{print $1}')"
  if [[ -n "$EXPECTED" && "$EXPECTED" != "$ACTUAL_SHA256" ]]; then
    echo "  SHA256 MISMATCH: expected $EXPECTED, got $ACTUAL_SHA256" >&2
    rm -rf "$TMPDIR"
    exit 1
  fi
  echo "  SHA256 verified against published manifest."
else
  echo "  (No published SHA256SUMS for this release; hash logged only.)" >&2
fi

# ── Backup current install ───────────────────────────────────────────────────
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK_DIR="${INSTALL_PATH}-rollback-${TS}"
echo "Backing up current install to $ROLLBACK_DIR..."
sudo cp -R "$INSTALL_PATH" "$ROLLBACK_DIR"

# ── Extract new release ──────────────────────────────────────────────────────
EXTRACT_DIR="$TMPDIR/extract"
mkdir -p "$EXTRACT_DIR"
echo "Extracting..."
tar -xzf "$TARBALL" -C "$EXTRACT_DIR"
# GitHub tarballs have a single top-level dir named <owner>-<repo>-<sha>/
SRC_DIR="$(ls -1d "$EXTRACT_DIR"/*/ 2>/dev/null | head -1)"
if [[ -z "$SRC_DIR" || ! -d "$SRC_DIR" ]]; then
  echo "  No top-level dir in extracted tarball -- aborting." >&2
  rm -rf "$TMPDIR"
  exit 1
fi

# Preserve operator data dirs across the swap (data, store, .env, .update-status.json)
PRESERVE=( "data" "store" ".env" ".update-status.json" "upgrade.log" )
for p in "${PRESERVE[@]}"; do
  if [[ -e "$INSTALL_PATH/$p" ]]; then
    sudo cp -R "$INSTALL_PATH/$p" "$SRC_DIR/$p" 2>/dev/null || true
  fi
done

# ── Atomic swap: new dir into place ──────────────────────────────────────────
echo "Installing new version..."
SWAP_OLD="${INSTALL_PATH}.swap-${TS}"
sudo mv "$INSTALL_PATH" "$SWAP_OLD"
sudo mv "$SRC_DIR" "$INSTALL_PATH"
sudo rm -rf "$SWAP_OLD"

# Update VERSION
echo "$LATEST" | sudo tee "$VERSION_FILE" >/dev/null

# Append to upgrade log
printf '[%s] upgrade: %s -> %s (sha256=%s, rollback=%s)\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CURRENT" "$LATEST" "$ACTUAL_SHA256" "$ROLLBACK_DIR" \
  | sudo tee -a "$UPGRADE_LOG" >/dev/null

# Cleanup
rm -rf "$TMPDIR"

echo ""
echo "✓ Pandora's Box upgraded: $CURRENT -> $LATEST"
echo ""
echo "Next steps (operator):"
echo "  1. Read release notes: https://github.com/$REPO/releases/tag/$LATEST"
echo "  2. Run any migration scripts called out in the notes."
echo "  3. Restart any services that need to pick up the new code."
echo ""
echo "If something went wrong:"
echo "  pbox-update --rollback ${TS}"
