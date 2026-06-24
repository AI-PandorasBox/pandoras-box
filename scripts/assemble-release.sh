#!/usr/bin/env bash
# scripts/assemble-release.sh -- Build the pandoras-box installer tarball and checksums
#
# Usage:
#   bash scripts/assemble-release.sh [VERSION]
#
# If VERSION is omitted, reads from git tag or defaults to "0.1.0".
#
# Outputs (in current directory):
#   pandoras-box-installer-vVERSION.tar.gz
#   SHA256SUMS
#
# The tarball contains:
#   pandoras-box-vVERSION/
#     install.sh, pbox-setup.sh
#     lib/*, config/*, hooks/*, modules/*, manuals/*.md, docs/*
#     README.md, CHANGELOG.md, DISCLAIMER.md, LICENSE
#     CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md
#     .sanitize-patterns, .gitignore

set -euo pipefail

VERSION="${1:-}"

# Determine version
if [[ -z "$VERSION" ]]; then
  VERSION=$(git describe --tags --exact-match 2>/dev/null || echo "")
  if [[ -z "$VERSION" ]]; then
    VERSION="v0.1.0"
    echo "No git tag found -- using default version $VERSION"
  fi
fi

# Normalise: ensure version starts with 'v'
[[ "$VERSION" == v* ]] || VERSION="v$VERSION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARBALL_NAME="pandoras-box-installer-${VERSION}.tar.gz"
STAGING_DIR=$(mktemp -d)
INNER_DIR="$STAGING_DIR/pandoras-box-${VERSION}"

echo "--------------------------------------------"
echo " Pandoras Box Release Assembly"
echo " Version : $VERSION"
echo " Output  : $TARBALL_NAME"
echo "--------------------------------------------"
echo ""

# --- Pre-package gate: OS-path lint -----------------------------------------
# Catches the recurring Mac-path bug class (hardcoded /opt/homebrew, /usr/local/bin/node,
# /Users/... , zsh shebangs) before anything is packaged for release. HARD findings
# abort assembly; SOFT findings are advisory.
if [[ -x "$SCRIPT_DIR/os-path-lint.sh" ]]; then
  echo "Running OS-path lint (pre-package gate)..."
  if ! bash "$SCRIPT_DIR/os-path-lint.sh" "$REPO_ROOT"; then
    echo ""
    echo "ABORT: os-path-lint reported HARD findings. Fix them before assembling a release." >&2
    exit 1
  fi
  echo ""
else
  echo "WARNING: scripts/os-path-lint.sh not found -- skipping the OS-path gate." >&2
fi

mkdir -p "$INNER_DIR"

# Helper: copy if source exists
cp_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -e "$src" ]]; then
    cp -r "$src" "$dst"
    echo "  [+] $src"
  else
    echo "  [-] SKIP (not found): $src"
  fi
}

echo "Assembling files..."

# Core scripts
cp_if_exists "$REPO_ROOT/install.sh"    "$INNER_DIR/install.sh"
cp_if_exists "$REPO_ROOT/pbox-setup.sh" "$INNER_DIR/pbox-setup.sh"

# Directories
for dir in lib config hooks modules docs manuals service-provider; do
  cp_if_exists "$REPO_ROOT/$dir" "$INNER_DIR/$dir"
done

# Top-level files
for file in README.md CHANGELOG.md DISCLAIMER.md DISCLAIMER-FRAMEWORK.md \
            LICENSE CODE_OF_CONDUCT.md CONTRIBUTING.md SECURITY.md \
            .sanitize-patterns .gitignore; do
  cp_if_exists "$REPO_ROOT/$file" "$INNER_DIR/$file"
done

# Remove PDF files from the installer tarball (PDFs are separate release assets)
# Users who want PDFs download them from Releases, not from the install pack
find "$INNER_DIR" -name "*.pdf" -delete 2>/dev/null || true
find "$INNER_DIR" -name "*.zip" -delete 2>/dev/null || true
# Remove node_modules if they crept in
find "$INNER_DIR" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
# Remove .env files
find "$INNER_DIR" -name "*.env" -o -name ".env" | xargs rm -f 2>/dev/null || true

echo ""
echo "Building tarball..."
tar -czf "$REPO_ROOT/$TARBALL_NAME" -C "$STAGING_DIR" "pandoras-box-${VERSION}"
rm -rf "$STAGING_DIR"

TARBALL_SIZE=$(du -sh "$REPO_ROOT/$TARBALL_NAME" | cut -f1)
echo "  OK: $TARBALL_NAME ($TARBALL_SIZE)"

echo ""
echo "Generating SHA256 checksums..."
cd "$REPO_ROOT"

CHECKSUM_FILE="SHA256SUMS"
> "$CHECKSUM_FILE"

# Installer tarball
shasum -a 256 "$TARBALL_NAME" >> "$CHECKSUM_FILE"
echo "  $TARBALL_NAME"

# PDFs -- if manuals/pdfs/ exists
PDF_DIR="$REPO_ROOT/manuals/pdfs"
if [[ -d "$PDF_DIR" ]]; then
  for pdf in "$PDF_DIR"/*.pdf "$PDF_DIR"/*.zip; do
    [[ -f "$pdf" ]] || continue
    (cd "$PDF_DIR" && shasum -a 256 "$(basename "$pdf")" >> "$REPO_ROOT/$CHECKSUM_FILE")
    echo "  $(basename "$pdf")"
  done
fi

echo ""
echo "SHA256SUMS:"
cat "$CHECKSUM_FILE"

echo ""
echo "--------------------------------------------"
echo " Assembly complete."
echo " Files ready for release upload:"
ls -lh "$REPO_ROOT/$TARBALL_NAME" "$REPO_ROOT/$CHECKSUM_FILE"
echo "--------------------------------------------"
