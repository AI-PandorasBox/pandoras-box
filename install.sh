#!/usr/bin/env bash
# install.sh -- Pandoras Box installer entry point
#
# This script is the one-liner install target:
#   bash <(curl -fsSL https://raw.githubusercontent.com/AI-PandorasBox/pandoras-box/main/install.sh)
#
# It also works when run from a cloned repo:
#   bash install.sh
#
# Behaviour:
#   - If pbox-setup.sh is present in the same directory, run it directly.
#   - Otherwise, download the full installer from the latest GitHub release,
#     verify the SHA256 checksum, and run it.

set -euo pipefail

# Portability layer: sets PBOX_OS (Darwin|Linux) + pbox_* helpers. install.sh
# runs STANDALONE (it is not sourced by pbox-setup.sh), so it must source this
# itself.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/os-compat.sh"

REPO="AI-PandorasBox/pandoras-box"
TARBALL_NAME="pandoras-box-installer"
MIN_MACOS="14"
MIN_NODE="22"   # _A2_INSTALLER_AND_GUIDES_V1

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
BOLD='\033[1m'; RESET='\033[0m'

err()  { echo -e "${RED}ERROR:${RESET} $*" >&2; }
warn() { echo -e "${YELLOW}WARN:${RESET}  $*"; }
ok()   { echo -e "${GREEN}  OK${RESET}  $*"; }
info() { echo -e "       $*"; }

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------
check_prereqs() {
  # _BACKUPS_SUDO_NOTICE_V1
  echo "  Note: the Encrypted Backups module will request sudo. The rest of the installer is user-only."

  local fail=0

  # OS / version gate (macOS 14+ on Darwin, Debian 13+/Ubuntu 24.04+ on Linux).
  pbox_os_check || fail=1

  # Node.js install hint differs per OS.
  local node_hint
  if [[ "$PBOX_OS" == Darwin ]]; then
    node_hint="  Install: brew install node"
  else
    node_hint="  Install: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  fi

  # Node.js
  if command -v node &>/dev/null; then
    local node_ver
    node_ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$node_ver" -lt "$MIN_NODE" ]]; then
      err "Node.js $MIN_NODE or later required (found $(node --version))"
      err "$node_hint"
      fail=1
    else
      ok "Node.js $(node --version)"
    fi
  else
    err "Node.js not found"
    err "$node_hint"
    fail=1
  fi

  if [[ "$PBOX_OS" == Darwin ]]; then
    # Homebrew (macOS package manager)
    if command -v brew &>/dev/null; then
      ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"
    else
      err "Homebrew not found"
      err '  Install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
      fail=1
    fi
  else
    # Linux: services are managed via systemd.
    if command -v systemctl &>/dev/null; then
      ok "systemd present ($(systemctl --version 2>/dev/null | head -1))"
    else
      err "systemctl not found -- Pandoras Box on Linux requires systemd"
      fail=1
    fi
  fi

  if [[ "$fail" -ne 0 ]]; then
    echo ""
    err "Prerequisites not met. Resolve the issues above and re-run."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Download installer from latest GitHub release
# ---------------------------------------------------------------------------
download_installer() {
  local tmpdir
  tmpdir=$(mktemp -d)

  echo ""
  info "Fetching latest release from github.com/$REPO ..."

  # Get latest release tag
  local tag
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null)

  if [[ -z "$tag" ]]; then
    err "Could not determine latest release. Check your internet connection."
    err "  You can also download manually from: https://github.com/$REPO/releases"
    exit 1
  fi

  info "Latest release: $tag"

  local tarball="${TARBALL_NAME}-${tag}.tar.gz"
  local tarball_url="https://github.com/${REPO}/releases/download/${tag}/${tarball}"
  local checksum_url="https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS"

  # Download tarball
  info "Downloading $tarball ..."
  if ! curl -fsSL "$tarball_url" -o "$tmpdir/$tarball"; then
    err "Download failed: $tarball_url"
    exit 1
  fi

  # Download and verify checksum
  info "Verifying checksum ..."
  if curl -fsSL "$checksum_url" -o "$tmpdir/SHA256SUMS" 2>/dev/null; then
    local expected
    expected=$(grep "$tarball" "$tmpdir/SHA256SUMS" | awk '{print $1}')
    local actual
    actual=$(pbox_checksum_sha256 "$tmpdir/$tarball")
    if [[ "$expected" != "$actual" ]]; then
      err "Checksum mismatch for $tarball"
      err "  Expected: $expected"
      err "  Got:      $actual"
      err "Do not proceed. Download may be corrupted."
      rm -rf "$tmpdir"
      exit 1
    fi
    ok "Checksum verified"
  else
    warn "Could not fetch checksum file. Proceeding without verification."
    warn "For a verified install, download from: https://github.com/$REPO/releases"
  fi

  # Extract and run
  info "Extracting ..."
  tar -xzf "$tmpdir/$tarball" -C "$tmpdir"

  local setup_script
  setup_script=$(find "$tmpdir" -name "pbox-setup.sh" | head -1)
  if [[ -z "$setup_script" ]]; then
    err "pbox-setup.sh not found in downloaded archive"
    rm -rf "$tmpdir"
    exit 1
  fi

  chmod +x "$setup_script"
  echo ""
  info "Starting Pandoras Box installer..."
  echo ""
  bash "$setup_script"

  rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}Pandoras Box -- Installer${RESET}"
echo "------------------------------------"
echo ""

check_prereqs

# If pbox-setup.sh is in the same directory, run it directly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/pbox-setup.sh" ]]; then
  info "Found pbox-setup.sh in $SCRIPT_DIR"
  info "Running installer..."
  echo ""
  bash "$SCRIPT_DIR/pbox-setup.sh"
else
  # Download from GitHub Releases
  download_installer
fi
