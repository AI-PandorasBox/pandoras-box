#!/usr/bin/env bash
# os-path-lint.sh  (STAGED — NOT APPLIED)
# proj_odin-installer-capability-fix / task003
#
# Flags the recurring Mac-path bug class in installer + lib + box-kit + module
# scripts (memory: mac-path-bug-class-linux-tools). Run it over the fleet repo
# tree before any release. Read-only; exits non-zero if any HARD finding hits.
#
#   bash os-path-lint.sh [ROOT]      # default ROOT=. (run from repo root)
#
# Finding classes:
#   HARD  — will break a cross-OS install (zsh shebang on Linux; /Users/qwerty
#           hardcode; /usr/local/bin/node literal as the ONLY node path; a bare
#           launchctl outside a Darwin guard).
#   SOFT  — Apple-Silicon vs Intel brew assumptions, unsubstituted __PLACEHOLDER__,
#           /usr/local/bin symlink targets (fine if best-effort, flagged anyway).
set -uo pipefail
ROOT="${1:-.}"
HARD=0; SOFT=0
red(){ printf '\033[0;31m%s\033[0m\n' "$*"; }
ylw(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
hdr(){ printf '\n== %s ==\n' "$*"; }

# Only lint shell + plist templates + mjs; skip node_modules, .git, docs.
mapfile -t FILES < <(find "$ROOT" \
  \( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/docs/*' -o -path '*/manuals/*' -o -name 'os-path-lint.sh' \) -prune -o \
  \( -name '*.sh' -o -name '*.mjs' -o -name '*.plist.template' -o -name '*.template' \) -print 2>/dev/null)

hdr "HARD: zsh shebang (fails on Linux; not guaranteed at /bin/zsh on Mac either)"
for f in "${FILES[@]}"; do
  if head -1 "$f" 2>/dev/null | grep -qE '^#!/bin/zsh'; then red "  $f"; HARD=$((HARD+1)); fi
done

hdr "HARD: /Users/qwerty hardcode (authoring-box path; absent on any real install)"
if grep -rIn '/Users/qwerty' "${FILES[@]}" 2>/dev/null; then HARD=$((HARD+1)); fi

hdr "HARD: /usr/local/bin/node as the ONLY node path (breaks Apple Silicon + Linux)"
# Flag a literal /usr/local/bin/node that is NOT behind a ${PBOX_NODE_BIN:-...}
# fallback resolved upstream, AND not part of a multi-candidate search loop.
for f in "${FILES[@]}"; do
  while IFS= read -r line; do
    case "$line" in
      *'/usr/local/bin/node'*)
        # acceptable patterns: a for-loop candidate list, or command -v fallback
        if echo "$line" | grep -qE 'for .*candidate|command -v|/opt/homebrew/bin/node.*\|\||\|\|.*\/usr\/local\/bin\/node'; then
          : # multi-candidate — soft at most
        elif echo "$line" | grep -qE '\$\{PBOX_NODE_BIN:-/usr/local/bin/node\}'; then
          ylw "  SOFT (PBOX_NODE_BIN fallback — only fires when standalone; prefer command -v): $f: $line"; SOFT=$((SOFT+1))
        else
          red "  $f: $line"; HARD=$((HARD+1))
        fi
        ;;
    esac
  done < <(grep -nE '/usr/local/bin/node' "$f" 2>/dev/null)
done

hdr "SOFT: launchctl call with no Darwin/command-v guard (no-ops/errs on Linux)"
# Advisory only: many module uninstall/setup scripts are macOS-targeted and the
# os-compat layer handles Linux service teardown separately. Skip comment-only
# matches and the dry-run shim that DEFINES a launchctl() stub.
for f in "${FILES[@]}"; do
  [[ "$f" == *.plist.template || "$f" == *.template ]] && continue
  [[ "$f" == *.mjs ]] && continue   # .mjs matches are comments, not shell calls
  [[ "$(basename "$f")" == setup-dry-run.sh ]] && continue   # defines the shim
  # require an actual command invocation (line starts with launchctl or sudo launchctl), not a comment
  if grep -qE '^\s*(sudo +)?launchctl ' "$f" 2>/dev/null; then
    if ! grep -qE 'PBOX_OS.*Darwin|command -v launchctl|uname.*Darwin|\[\[ .*Darwin' "$f" 2>/dev/null; then
      ylw "  SOFT: $f (uses launchctl with no Darwin/command-v guard; OK if macOS-only)"; SOFT=$((SOFT+1))
    fi
  fi
done

hdr "HARD: /opt/homebrew bin hardcode as a value (breaks Linux + Intel Macs)"
# Flag a literal /opt/homebrew/bin/<tool> assigned to a const/var (e.g.
# const FFMPEG = '/opt/homebrew/bin/ffmpeg') with no portable fallback.
# Acceptable: PATH-list strings (plist/template), multi-candidate for-loops,
# command -v / '||' fallbacks, and comment examples ('e.g.', '--').
for f in "${FILES[@]}"; do
  [[ "$f" == *.plist.template || "$f" == *.template ]] && continue
  while IFS= read -r line; do
    case "$line" in
      *'/opt/homebrew/'*)
        # skip comments, PATH-list strings, multi-candidate, and command -v fallbacks
        if echo "$line" | grep -qE '^\s*(//|#|\*)|e\.g\.|for .*candidate|command -v|\|\||/usr/local/bin:.*/opt/homebrew|PATH'; then
          : # acceptable pattern
        else
          red "  $f: $line"; HARD=$((HARD+1))
        fi
        ;;
    esac
  done < <(grep -nE '/opt/homebrew/' "$f" 2>/dev/null)
done

hdr "SOFT: unsubstituted __PLACEHOLDER__ tokens (verify the sed substitution covers them)"
if grep -rInE '__[A-Z_]+__' "${FILES[@]}" 2>/dev/null | grep -vE '\.template'; then SOFT=$((SOFT+1)); fi

hdr "SOFT: /usr/local/bin symlink targets (best-effort is fine; flagged for review)"
grep -rIn 'ln -sf .*/usr/local/bin' "${FILES[@]}" 2>/dev/null && SOFT=$((SOFT+1)) || true

echo
echo "================================================================"
echo "  HARD findings: $HARD    SOFT findings: $SOFT"
echo "================================================================"
[[ "$HARD" -gt 0 ]] && { red "FAIL — hard findings present"; exit 1; }
ylw "PASS (no hard findings; review SOFT items)"; exit 0
