#!/bin/bash
# Tails the MC log and POSTs death events to a Discord webhook.
set -euo pipefail

WEBHOOK_URL="${DISCORD_DEATH_WEBHOOK_URL:-}"
LOG="/data/logs/latest.log"

if [ -z "$WEBHOOK_URL" ]; then
  echo "[death-feed] DISCORD_DEATH_WEBHOOK_URL not set — disabled."
  exit 0
fi

echo "[death-feed] Waiting for $LOG to appear..."
while [ ! -f "$LOG" ]; do sleep 5; done
echo "[death-feed] Watching for deaths in $LOG"

tail -F "$LOG" | grep --line-buffered -iE \
  "\[Server thread/INFO\].*[A-Za-z0-9_]{2,16} (was |died|fell|drowned|burned|suffocated|blew up|hit the ground|tried to swim|went up in flames|walked into fire|was struck by lightning|starved to death|withered away)" \
| while IFS= read -r line; do
  MSG=$(printf '%s' "$line" | sed 's/^\[[0-9:]*\] \[.*INFO\]: //')
  PAYLOAD=$(jq -cn --arg msg "💀 $MSG" '{"embeds":[{"description":$msg,"color":13632027}]}')
  curl -sf -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK_URL" > /dev/null || true
done
