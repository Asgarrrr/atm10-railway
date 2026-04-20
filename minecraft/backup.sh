#!/bin/bash
# Minecraft world backup script
# Runs inside the minecraft container, triggered by cron or manually.
# Backs up world directories + config to /data/backups/<timestamp>.tar.gz

set -euo pipefail

# ── Config (from env vars set by entrypoint.sh) ───────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
MAX_KEEP="${BACKUP_MAX_KEEP:-5}"
RCON_HOST="${RCON_HOST:-localhost}"
RCON_PORT="${RCON_PORT:-25575}"
RCON_PASS="${RCON_PASSWORD:-}"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")
BACKUP_FILE="${BACKUP_DIR}/${TIMESTAMP}.tar.gz"

# Source env file written by entrypoint (for cron context where env is stripped)
if [ -f /run/backup.env ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source /run/backup.env
  set +o allexport
  RCON_PASS="${RCON_PASSWORD:-}"
fi

log() { echo "[backup] $(date +'%H:%M:%S') $*"; }

# ── RCON helper ───────────────────────────────────────────────────────────────
rcon() {
  if [ -z "$RCON_PASS" ]; then return 0; fi
  rcon-cli \
    --host "$RCON_HOST" \
    --port "$RCON_PORT" \
    --password "$RCON_PASS" \
    "$@" 2>/dev/null || true  # non-fatal: server may be paused
}

# ── Pre-backup: flush world to disk ───────────────────────────────────────────
log "Disabling auto-save..."
rcon "save-off"

log "Flushing world to disk..."
rcon "save-all flush"
sleep 5  # give the server time to finish writing

# ── Build list of paths to include ───────────────────────────────────────────
INCLUDE=()
for dir in world world_nether world_the_end; do
  [ -d "/data/$dir" ] && INCLUDE+=("$dir")
done
for file in config server.properties ops.json whitelist.json banned-players.json banned-ips.json; do
  [ -e "/data/$file" ] && INCLUDE+=("$file")
done

if [ ${#INCLUDE[@]} -eq 0 ]; then
  log "Nothing to backup — world directories not found yet."
  rcon "save-on"
  exit 0
fi

# ── Create archive ────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
log "Creating archive: $BACKUP_FILE"
tar -czf "$BACKUP_FILE" -C /data "${INCLUDE[@]}"
SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Archive created: $SIZE"

# ── Post-backup: re-enable auto-save and notify ───────────────────────────────
log "Re-enabling auto-save..."
rcon "save-on"
rcon "say [Backup] Sauvegarde terminée (${TIMESTAMP}, ${SIZE})"

# ── Rotate: keep only the last MAX_KEEP archives ─────────────────────────────
TOTAL=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" | wc -l)
if [ "$TOTAL" -gt "$MAX_KEEP" ]; then
  TO_DELETE=$((TOTAL - MAX_KEEP))
  log "Rotating: deleting $TO_DELETE old archive(s) (keeping last $MAX_KEEP)"
  find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" \
    | sort | head -n "$TO_DELETE" | xargs rm -f
fi

log "Done. Backups in $BACKUP_DIR:"
find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" | sort | while read -r f; do
  echo "  $(basename "$f")  ($(du -sh "$f" | cut -f1))"
done
