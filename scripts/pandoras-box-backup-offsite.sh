#!/usr/bin/env bash
# pandoras-box-backup-offsite.sh -- weekly B2 mirror of latest encrypted blob.
#
# Marker: _PBOX_OFFSITE_DAEMON_V1
#
# Triggered by /Library/LaunchDaemons/com.pandoras-box.backup-offsite.plist
# Sundays at 01:00 (root). Reads B2 creds from /usr/local/etc/pandoras-box-backup.env.
# Skips with no-op if B2_KEYID is unset.

set -uo pipefail

LABEL="pandoras-box-backup-offsite"
ENV_FILE="/usr/local/etc/pandoras-box-backup.env"
LOG="/tmp/pandoras-box-offsite-daemon.log"

echo
echo "=== $LABEL $(date) ==="

if [[ ! -r "$ENV_FILE" ]]; then echo "FATAL: env not readable: $ENV_FILE"; exit 2; fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${B2_KEYID:-}" || -z "${B2_APPKEY:-}" || -z "${B2_BUCKET:-}" ]]; then
  echo "B2 not configured -- nothing to do. Exiting cleanly."
  exit 0
fi

: "${BACKUP_VOL:=/Users/Shared/pandoras-box-backups}"
: "${B2_RETENTION_DAYS:=14}"

LATEST_BLOB=$(readlink "$BACKUP_VOL/latest" 2>/dev/null || true)
if [[ -z "$LATEST_BLOB" || ! -f "$LATEST_BLOB" ]]; then
  echo "FATAL: no local 'latest' blob to mirror"; exit 3
fi

BLOB_NAME=$(basename "$LATEST_BLOB")
RCLONE=$(command -v rclone || true)
if [[ -z "$RCLONE" ]]; then
  echo "FATAL: rclone not installed -- 'brew install rclone'"; exit 4
fi

# Configure a transient rclone remote from env so we don't depend on ~/.config.
RCLONE_REMOTE="pbox-b2"
export RCLONE_CONFIG="/tmp/rclone-pbox-offsite.conf"
cat > "$RCLONE_CONFIG" <<CONF
[$RCLONE_REMOTE]
type = b2
account = $B2_KEYID
key = $B2_APPKEY
hard_delete = true
CONF
chmod 600 "$RCLONE_CONFIG"

echo "uploading $BLOB_NAME -> b2://$B2_BUCKET/PandorasBox/$BLOB_NAME"
if "$RCLONE" copyto "$LATEST_BLOB" "$RCLONE_REMOTE:$B2_BUCKET/PandorasBox/$BLOB_NAME" --b2-disable-checksum 2>&1; then
  echo "B2=ok"
  STATUS=ok
  RC=0
else
  echo "B2=fail"
  STATUS=fail
  RC=5
fi

# Retention: delete blobs in the remote older than $B2_RETENTION_DAYS.
"$RCLONE" delete --min-age "${B2_RETENTION_DAYS}d" "$RCLONE_REMOTE:$B2_BUCKET/PandorasBox/" 2>>"$LOG" || true

rm -f "$RCLONE_CONFIG"

# Stamp file for the catch-up wrapper (mirrors the local Zeus behaviour).
if [[ "$STATUS" == "ok" ]]; then
  date -u +%FT%TZ > "$BACKUP_VOL/.last-offsite-success"
fi

echo "=== $LABEL $(date) -- $STATUS (exit $RC) ==="
exit "$RC"
