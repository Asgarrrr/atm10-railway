#!/bin/bash
# Restore a single player's playerdata .dat from a backup archive.
# Usage: mc-restore <player_name> [backup_timestamp]

set -euo pipefail

PLAYER="${1:-}"
BACKUP_HINT="${2:-}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
DATA_DIR="/data"
RCON_HOST="${RCON_HOST:-localhost}"
RCON_PORT="${RCON_PORT:-25575}"
RCON_PASS="${RCON_PASSWORD:-}"

log() { echo "[restore] $(date +'%H:%M:%S') $*"; }

if [ -z "$PLAYER" ]; then
  echo "Usage: mc-restore <player_name> [backup_timestamp]" >&2
  exit 1
fi

# Load env written by entrypoint (API server strips the environment)
if [ -f /run/backup.env ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source /run/backup.env
  set +o allexport
  RCON_PASS="${RCON_PASSWORD:-}"
fi

rcon() {
  if [ -z "$RCON_PASS" ]; then return 0; fi
  rcon-cli --host "$RCON_HOST" --port "$RCON_PORT" --password "$RCON_PASS" "$@" 2>/dev/null || true
}

# ── Find UUID from usercache.json ─────────────────────────────────────────────
USERCACHE="$DATA_DIR/usercache.json"
if [ ! -f "$USERCACHE" ]; then
  echo "usercache.json introuvable — le joueur doit s'être connecté au moins une fois." >&2
  exit 1
fi

UUID=$(jq -r --arg name "$PLAYER" '.[] | select(.name == $name) | .uuid' "$USERCACHE")
if [ -z "$UUID" ] || [ "$UUID" = "null" ]; then
  echo "Joueur '$PLAYER' introuvable dans usercache.json." >&2
  exit 1
fi

log "UUID de $PLAYER : $UUID"

# ── Select backup file ────────────────────────────────────────────────────────
if [ -n "$BACKUP_HINT" ]; then
  BACKUP_FILE="$BACKUP_DIR/${BACKUP_HINT}.tar.gz"
  if [ ! -f "$BACKUP_FILE" ]; then
    echo "Backup '$BACKUP_HINT' introuvable dans $BACKUP_DIR." >&2
    exit 1
  fi
else
  BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" | sort | tail -1)
  if [ -z "$BACKUP_FILE" ]; then
    echo "Aucune backup trouvée dans $BACKUP_DIR." >&2
    exit 1
  fi
fi

TIMESTAMP=$(basename "$BACKUP_FILE" .tar.gz)
log "Backup sélectionnée : $TIMESTAMP"

# ── Verify player data exists in backup ──────────────────────────────────────
if ! tar -tzf "$BACKUP_FILE" "world/playerdata/${UUID}.dat" &>/dev/null; then
  echo "Données de '$PLAYER' ($UUID) introuvables dans la backup $TIMESTAMP." >&2
  exit 1
fi

# ── Kick player if online to avoid overwrite race ────────────────────────────
rcon "kick $PLAYER Restauration de l'inventaire en cours..."
sleep 2

# ── Extract and restore ───────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

tar -xzf "$BACKUP_FILE" -C "$TMP_DIR" "world/playerdata/${UUID}.dat"

TARGET="$DATA_DIR/world/playerdata/${UUID}.dat"
if [ -f "$TARGET" ]; then
  cp "$TARGET" "${TARGET}.pre-restore"
  log "Fichier actuel sauvegardé : ${TARGET}.pre-restore"
fi

cp "$TMP_DIR/world/playerdata/${UUID}.dat" "$TARGET"
log "Inventaire de '$PLAYER' restauré depuis $TIMESTAMP."

rcon "say [Restore] Inventaire de $PLAYER restauré depuis $TIMESTAMP."
echo "OK:$TIMESTAMP"
