#!/usr/bin/env bash
# pandoras-box-backup.sh -- Daily encrypted backup (LaunchDaemon, root)
#
# Marker: _PBOX_BACKUP_DAEMON_V1
#
# Installed by setup-backups.sh at /Users/Shared/pandoras-box-backup-scripts/.
# Triggered by /Library/LaunchDaemons/com.pandoras-box.backup.plist at 03:30 daily.
# Runs as root (TCC-safe when /bin/bash has Full Disk Access).
#
# Scope (configurable via /usr/local/etc/pandoras-box-backup.env):
#   - $INSTALL_PATH                full tarball, excluding node_modules + .env + secrets
#   - SQLite stores under $INSTALL_PATH (online .backup for consistency)
#   - Optional Postgres dumps (per DB configured in env)
#   - Optional Desktop / Documents (opt-in -- requires FDA)
#
# Per-component size assertion: 0-byte components mark FATAL_REASON and the
# `latest` symlink is NOT updated. Optional [OK]/[FAIL] email via SMTP relay.

set -uo pipefail   # NOT -e -- report sender must run on partial failure

LABEL="pandoras-box-backup"
LOG="/tmp/pandoras-box-backup-daemon.log"
ENV_FILE="/usr/local/etc/pandoras-box-backup.env"
SCRIPTS_DIR="/Users/Shared/pandoras-box-backup-scripts"
REPORT_MJS="$SCRIPTS_DIR/pandoras-box-backup-daily-report.mjs"
RECOVERY_TEMPLATE="$SCRIPTS_DIR/RECOVERY-template.md"
NODE="/usr/local/bin/node"
AGE="/opt/homebrew/bin/age"
SQLITE3="/usr/bin/sqlite3"
STAMP=$(date +%Y-%m-%d)

# stdout/stderr captured by plist StandardOut/Err -- no exec-tee here.
echo
echo "=== $LABEL $(date) ==="

# ── Preflight ────────────────────────────────────────────────────────────────
if [[ ! -r "$ENV_FILE" ]]; then
  echo "FATAL: env file not readable: $ENV_FILE"; exit 2
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${BACKUP_VOL:=/Users/Shared/pandoras-box-backups}"
: "${KEEP_DAYS:=60}"
: "${MIN_BLOB_SIZE_BYTES:=$((100*1024*1024))}"
: "${INSTALL_PATH:=/opt/pandoras-box}"

if [[ -z "${AGE_PUBKEY_FILE:-}" || ! -r "$AGE_PUBKEY_FILE" ]]; then
  echo "FATAL: AGE_PUBKEY_FILE missing or unreadable: ${AGE_PUBKEY_FILE:-}"; exit 2
fi
PUBKEY=$(head -1 "$AGE_PUBKEY_FILE")
[[ "$PUBKEY" == age1* ]] || { echo "FATAL: malformed pubkey"; exit 2; }

[[ -x "$AGE" ]]     || { echo "FATAL: age not installed at $AGE -- 'brew install age'"; exit 2; }
[[ -x "$SQLITE3" ]] || { echo "FATAL: sqlite3 not at $SQLITE3"; exit 2; }

RUN_DIR="$BACKUP_VOL/$STAMP"
LATEST="$BACKUP_VOL/latest"
mkdir -p "$RUN_DIR"/{install,sqlite,postgres,desktop,documents}
chmod 700 "$RUN_DIR"

# ── Tracking ─────────────────────────────────────────────────────────────────
COMP_NAMES=()
COMP_PATHS=()
COMP_BYTES=()
COMP_STATUS=()
FATAL_REASON=""

record () {
  local name="$1"; local path="$2"; local status="$3"
  local bytes=0
  [[ -f "$path" ]] && bytes=$(stat -f%z "$path" 2>/dev/null || echo 0)
  COMP_NAMES+=("$name"); COMP_PATHS+=("$path")
  COMP_BYTES+=("$bytes"); COMP_STATUS+=("$status")
  echo "  -> $name: $status ($bytes bytes)"
}

assert_nonempty () {
  local name="$1"; local path="$2"
  if [[ -s "$path" ]]; then record "$name" "$path" "ok"; return 0; fi
  record "$name" "$path" "empty"
  FATAL_REASON="${FATAL_REASON:+$FATAL_REASON; }empty $name"
  return 1
}

# ── 1. $INSTALL_PATH tarball ─────────────────────────────────────────────────
echo "[1/5] $INSTALL_PATH tarball"
INST_OUT="$RUN_DIR/install/install-${STAMP}.tar.gz"
if [[ -d "$INSTALL_PATH" ]]; then
  tar -C "$(dirname "$INSTALL_PATH")" \
    --exclude="$(basename "$INSTALL_PATH")/*/node_modules" \
    --exclude="$(basename "$INSTALL_PATH")/*/.env" \
    --exclude="$(basename "$INSTALL_PATH")/secrets" \
    --exclude="$(basename "$INSTALL_PATH")/*/store/*.db-wal" \
    --exclude="$(basename "$INSTALL_PATH")/*/store/*.db-shm" \
    -czf "$INST_OUT" "$(basename "$INSTALL_PATH")" || true
  assert_nonempty "install.full" "$INST_OUT"
else
  record "install.full" "$INSTALL_PATH" "missing"
fi

# ── 2. SQLite stores ─────────────────────────────────────────────────────────
echo "[2/5] SQLite stores"
while IFS= read -r db; do
  [[ -z "$db" ]] && continue
  [[ ! -r "$db" ]] && { record "sqlite.$(basename "$db")" "$db" "unreadable"; continue; }
  out="$RUN_DIR/sqlite/$(basename "$db" .db)-${STAMP}.db"
  "$SQLITE3" "$db" ".backup '$out'" 2>&1 || true
  assert_nonempty "sqlite.$(basename "$db" .db)" "$out"
done < <(find "$INSTALL_PATH" -maxdepth 4 -name '*.db' -type f 2>/dev/null)

# ── 3. Optional Postgres dumps ───────────────────────────────────────────────
# Configured via env: PG_DBS="ccs_db:ccs_user:$CCS_DB_PASS cpm_db:cpm_user:$CPM_DB_PASS"
echo "[3/5] Postgres dumps (optional)"
if [[ -n "${PG_DBS:-}" ]]; then
  PG_DUMP=$(command -v pg_dump || true)
  [[ -z "$PG_DUMP" ]] && { record "postgres" "" "pg_dump not installed"; }
  if [[ -x "$PG_DUMP" ]]; then
    for spec in $PG_DBS; do
      db="${spec%%:*}"; rest="${spec#*:}"; user="${rest%%:*}"; pw="${rest#*:}"
      out="$RUN_DIR/postgres/${db}-${STAMP}.dump"
      PGPASSWORD="$pw" "$PG_DUMP" -U "$user" -h localhost -Fc --no-password "$db" > "$out" 2>>"$LOG" || true
      assert_nonempty "postgres.$db" "$out"
    done
  fi
else
  echo "  (no PG_DBS configured -- skipping)"
fi

# ── 4. Optional Desktop / Documents (TCC-sensitive) ──────────────────────────
echo "[4/5] Desktop / Documents (opt-in)"
HOME_USER="${BACKUP_HOME_USER:-${SUDO_USER:-}}"
if [[ -n "$HOME_USER" ]] && id "$HOME_USER" &>/dev/null; then
  HOME_DIR=$(eval echo "~$HOME_USER")
  if [[ "${BACKUP_DESKTOP:-no}" == "yes" && -d "$HOME_DIR/Desktop" ]]; then
    DK_OUT="$RUN_DIR/desktop/desktop-${STAMP}.tar.gz"
    tar -C "$HOME_DIR" --exclude='*/node_modules' --exclude='*.bak*' -czf "$DK_OUT" Desktop || true
    assert_nonempty "desktop" "$DK_OUT"
  fi
  if [[ "${BACKUP_DOCUMENTS:-no}" == "yes" && -d "$HOME_DIR/Documents" ]]; then
    DC_OUT="$RUN_DIR/documents/documents-${STAMP}.tar.gz"
    tar -C "$HOME_DIR" --exclude='*/node_modules' --exclude='*.bak*' -czf "$DC_OUT" Documents || true
    assert_nonempty "documents" "$DC_OUT"
  fi
fi

# ── 5. MANIFEST + age encrypt + latest symlink ───────────────────────────────
echo "[5/5] manifest + age encrypt"
MANIFEST="$RUN_DIR/MANIFEST.txt"
{
  echo "Pandoras Box backup -- $STAMP"
  echo "host: $(hostname)"
  echo "components:"
  i=0
  while [[ $i -lt ${#COMP_NAMES[@]} ]]; do
    printf '  %-30s %-10s %12s bytes  %s\n' \
      "${COMP_NAMES[$i]}" "${COMP_STATUS[$i]}" "${COMP_BYTES[$i]}" "${COMP_PATHS[$i]}"
    i=$((i+1))
  done
  [[ -n "$FATAL_REASON" ]] && echo "FATAL_REASON: $FATAL_REASON"
} > "$MANIFEST"

# Copy recovery template alongside the blob (plaintext, intentional).
if [[ -f "$RECOVERY_TEMPLATE" ]]; then
  cp "$RECOVERY_TEMPLATE" "$BACKUP_VOL/RECOVERY.md"
fi

ENCRYPTED="$BACKUP_VOL/${STAMP}.tar.age"
TARTMP="$BACKUP_VOL/.${STAMP}.tar.tmp"
tar -C "$BACKUP_VOL" -cf "$TARTMP" "$STAMP" 2>>"$LOG" || true
"$AGE" -r "$PUBKEY" -o "$ENCRYPTED" < "$TARTMP" 2>>"$LOG" || true
rm -f "$TARTMP"

ENC_SIZE=0
[[ -f "$ENCRYPTED" ]] && ENC_SIZE=$(stat -f%z "$ENCRYPTED" 2>/dev/null || echo 0)
echo "encrypted: $ENCRYPTED ($ENC_SIZE bytes)"

if [[ -z "$FATAL_REASON" && "$ENC_SIZE" -ge "$MIN_BLOB_SIZE_BYTES" ]]; then
  ln -sfn "$ENCRYPTED" "$LATEST"
  echo "latest -> $ENCRYPTED"
  VERDICT=ok
  RC=0
else
  echo "REFUSING to update latest (fatal=$FATAL_REASON enc_size=$ENC_SIZE min=$MIN_BLOB_SIZE_BYTES)"
  VERDICT=fail
  RC=1
fi

# Retain only $KEEP_DAYS of plain run dirs + encrypted blobs.
find "$BACKUP_VOL" -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
find "$BACKUP_VOL" -maxdepth 1 -type f -name '20*.tar.age' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
# Clean plaintext dirs older than 1 day (only keep the most recent for inspection).
find "$BACKUP_VOL" -maxdepth 1 -type d -name '20*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true

# ── Report ───────────────────────────────────────────────────────────────────
if [[ -x "$NODE" && -f "$REPORT_MJS" ]]; then
  PAYLOAD="/tmp/pandoras-box-backup-report-payload.json"
  {
    printf '{"label":"%s","stamp":"%s","verdict":"%s","encrypted_blob":"%s","encrypted_size_bytes":%s,"fatal_reason":"%s","components":[' \
      "$LABEL" "$STAMP" "$VERDICT" "$ENCRYPTED" "$ENC_SIZE" \
      "$(printf '%s' "$FATAL_REASON" | sed 's/"/\\"/g')"
    i=0
    while [[ $i -lt ${#COMP_NAMES[@]} ]]; do
      sep=","; [[ $i -eq $(( ${#COMP_NAMES[@]} - 1 )) ]] && sep=""
      printf '{"name":"%s","path":"%s","bytes":%s,"status":"%s"}%s' \
        "${COMP_NAMES[$i]}" "${COMP_PATHS[$i]}" "${COMP_BYTES[$i]}" "${COMP_STATUS[$i]}" "$sep"
      i=$((i+1))
    done
    printf ']}'
  } > "$PAYLOAD"
  chmod 600 "$PAYLOAD"
  "$NODE" "$REPORT_MJS" "$PAYLOAD" 2>&1 || echo "WARN: report send failed (non-fatal)"
  rm -f "$PAYLOAD"
fi

echo "=== $LABEL $(date) -- $VERDICT (exit $RC) ==="
exit "$RC"
