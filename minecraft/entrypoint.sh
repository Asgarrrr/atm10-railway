#!/bin/bash
# Wraps the itzg /start entrypoint to inject a backup cron job before launch.

set -euo pipefail

# ── Export env vars for cron (cron strips the environment) ───────────────────
printenv | grep -E "^(RCON_PASSWORD|RCON_PORT|RCON_HOST|BACKUP_|MC_)" \
  > /run/backup.env
chmod 600 /run/backup.env

# ── Register cron job if backups are enabled ──────────────────────────────────
if [ "${BACKUP_ENABLED:-true}" = "true" ]; then
  SCHEDULE="${BACKUP_CRON:-0 */6 * * *}"
  LOG="/data/backups/cron.log"

  # Write crontab entry
  printf '%s root /usr/local/bin/mc-backup >> %s 2>&1\n' "$SCHEDULE" "$LOG" \
    > /etc/cron.d/mc-backup
  chmod 0644 /etc/cron.d/mc-backup

  cron
  echo "[entrypoint] Backup cron registered: ${SCHEDULE}"
else
  echo "[entrypoint] Backups disabled (BACKUP_ENABLED=${BACKUP_ENABLED})"
fi

# ── Death feed ────────────────────────────────────────────────────────────────
/usr/local/bin/mc-death-feed &

# ── Hand off to the itzg entrypoint ──────────────────────────────────────────
exec /start
