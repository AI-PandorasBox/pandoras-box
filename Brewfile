# _A2_INSTALLER_AND_GUIDES_V1
#
# Brewfile for Pandora's Box. Run after the interactive installer to pre-install
# all macOS-side dependencies in one shot:
#
#   brew bundle install --file=Brewfile
#
# Modules you don't install can have their deps commented out; the installer
# generates a tailored Brewfile.local on first run reflecting your actual choices.
# This file is the master list — every dep across every module + add-on.

# ── Core (required by ANY install) ────────────────────────────────────────────
brew "node"        # runtime; v22+ recommended
brew "sqlite"      # DB
brew "jq"          # JSON tooling used in scripts
brew "git"         # source control
brew "rclone"      # off-site backup (Backblaze B2 / S3-compatible)

# ── Cask: Tailscale for mobile-to-Pbox access ────────────────────────────────
cask "tailscale"   # free for personal use; alternatives: WireGuard, ZeroTier

# ── Media production module (video / audio) ──────────────────────────────────
brew "ffmpeg"      # video pipeline

# ── Offline knowledge module (Kiwix) ─────────────────────────────────────────
brew "kiwix-tools" # Kiwix CLI
cask "docker"      # Docker Desktop hosts the Kiwix container

# ── Vault Graph module ───────────────────────────────────────────────────────
cask "obsidian"    # vault host

# ── Argus dep-scan (optional) ────────────────────────────────────────────────
brew "gh"          # GitHub CLI (used for dep-scan + release downloads)

# ── content-classifier sidecar ───────────────────────────────────────────────
brew "python@3.11" # content-classifier sidecar runs in Python 3.11+

# ── Optional convenience ─────────────────────────────────────────────────────
# cask "iterm2"    # better terminal
# brew "age"       # if you choose encrypted-backups module
