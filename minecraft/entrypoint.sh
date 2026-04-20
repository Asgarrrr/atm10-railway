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

# ── Modpack installation (Eternia — custom Forge 1.19.2 pack) ────────────────
_MODPACK_ZIP=/modpack/Eternia.zip
_HASH_FILE=/data/.modpack-hash
_MODS_DIR=/data/mods

_install_mods() {
  echo "[modpack] Installing mods from Eternia.zip..."
  mkdir -p "$_MODS_DIR"

  # Apply config/resource overrides from the zip
  unzip -q -o "$_MODPACK_ZIP" "overrides/*" -d /tmp/cf-overrides 2>/dev/null || true
  if [ -d /tmp/cf-overrides/overrides ]; then
    cp -a /tmp/cf-overrides/overrides/. /data/
    rm -rf /tmp/cf-overrides
    echo "[modpack] Overrides applied"
  fi

  local manifest total i=0
  manifest=$(unzip -p "$_MODPACK_ZIP" manifest.json)
  total=$(printf '%s' "$manifest" | jq '.files | length')
  echo "[modpack] Downloading $total mods via CurseForge API..."

  while IFS= read -r entry; do
    local proj file req url fname
    proj=$(printf '%s' "$entry" | jq -r '.projectID')
    file=$(printf '%s' "$entry" | jq -r '.fileID')
    req=$(printf '%s'  "$entry" | jq -r '.required')
    i=$((i+1))

    url=$(curl -sf -H "x-api-key: ${CF_API_KEY:-}" \
      "https://api.curseforge.com/v1/mods/${proj}/files/${file}/download-url" \
      | jq -r '.data // empty')

    if [ -z "$url" ]; then
      if [ "$req" = "true" ]; then
        echo "[modpack] ERROR: no download URL for project=$proj file=$file"
        return 1
      fi
      echo "[modpack] SKIP optional project=$proj file=$file"
      continue
    fi

    fname=$(basename "$url" | sed 's/?.*//')
    echo "[modpack] [$i/$total] $fname"
    curl -sfL -o "$_MODS_DIR/$fname" "$url"
  done < <(printf '%s' "$manifest" | jq -c '.files[]')

  md5sum "$_MODPACK_ZIP" > "$_HASH_FILE"
  echo "[modpack] Done — $i mods installed"
}

_CURRENT_HASH=$(md5sum "$_MODPACK_ZIP" | awk '{print $1}')
_STORED_HASH=$(awk '{print $1}' "$_HASH_FILE" 2>/dev/null || echo "none")
if [ "$_CURRENT_HASH" != "$_STORED_HASH" ]; then
  _install_mods
else
  echo "[modpack] Mods up to date (hash match), skipping install"
fi

# ── Hand off to the itzg entrypoint ──────────────────────────────────────────
exec /start
