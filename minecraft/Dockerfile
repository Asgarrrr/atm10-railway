# ── Minecraft Server — Eternia (modpack) ──────────────────────────────────────
#
# This service runs the game server only.
# The Discord bot (discord-bot/) is deployed as a separate Railway service.
#
FROM itzg/minecraft-server:java21

# ── Licence ───────────────────────────────────────────────────────────────────
ENV EULA=TRUE

# ── Modpack ───────────────────────────────────────────────────────────────────
# CF_API_KEY must be set as a Railway secret — used at runtime to download mods.
# Get your key at https://console.curseforge.com/
# Eternia is a custom modpack (not published on CurseForge), so we use TYPE=FORGE
# and install mods from the bundled ZIP manifest at container startup.
ENV TYPE=FORGE
ENV VERSION=1.19.2
ENV FORGE_VERSION=43.4.0

# ── Memory ────────────────────────────────────────────────────────────────────
# Eternia has ~54 mods (Forge 1.19.2). 6 GB max heap is comfortable.
# INIT_MEMORY sets -Xms (committed at startup); MEMORY sets -Xmx (ceiling).
# Railway bills on RSS, so starting lower reduces idle cost.
# Override via Railway env vars if you need more headroom (e.g. MEMORY=8G).
ENV INIT_MEMORY=2G
ENV MEMORY=6G

# ── JVM tuning ────────────────────────────────────────────────────────────────
# Aikar's flags: G1GC tuned for large heaps with many short-lived objects —
# the community standard for modded Minecraft servers.
ENV USE_AIKAR_FLAGS=true
# Metaspace grows significantly with 500+ mods; cap it to avoid unbounded growth.
# UseContainerSupport makes the JVM respect Railway's cgroup memory limits.
ENV JVM_XX_OPTS="-XX:+UseContainerSupport"

# ── Watchdog ──────────────────────────────────────────────────────────────────
# Disable the server watchdog (-1 = off). Without this, the JVM being frozen by
# autopause looks like a hung tick and triggers an emergency restart.
ENV MAX_TICK_TIME=-1

# ── Auto-pause ────────────────────────────────────────────────────────────────
# When no players are connected the JVM process is sent SIGSTOP, dropping CPU
# usage to near-zero. A TCP knock on the MC port wakes it transparently.
# Railway still bills for allocated RAM while paused, but CPU billing stops.
ENV ENABLE_AUTOPAUSE=TRUE
# Pause 5 minutes after the last player disconnects.
ENV AUTOPAUSE_TIMEOUT_EST=300
# Pause 10 minutes after startup if nobody has connected yet.
ENV AUTOPAUSE_TIMEOUT_INIT=600

# ── RCON ──────────────────────────────────────────────────────────────────────
# Required for the Discord bot to send in-game commands (/stop, /say, /cmd…).
# Set RCON_PASSWORD as a Railway secret on this service AND on the bot service
# (as MC_RCON_PASSWORD) — use the same value on both sides.
ENV ENABLE_RCON=true
ENV RCON_PORT=25575

# ── World / chunk settings ────────────────────────────────────────────────────
# Lower distances reduce the in-memory chunk cache and entity tick CPU cost.
# Raise VIEW_DISTANCE to 8–10 via Railway env vars if players find 6 too low.
ENV VIEW_DISTANCE=6
ENV SIMULATION_DISTANCE=4

# ── Misc ──────────────────────────────────────────────────────────────────────
# Rotate logs so the Railway volume doesn't fill up over time.
ENV ENABLE_ROLLING_LOGS=TRUE

# ── Backup ────────────────────────────────────────────────────────────────────
# Automatic world backups saved to /data/backups/ on the persistent volume.
# Override any of these via Railway environment variables.
ENV BACKUP_ENABLED=true
# Cron schedule — default: every 30 minutes. Uses standard cron syntax.
ENV BACKUP_CRON="*/30 * * * *"
# Number of .tar.gz archives to keep before rotating out old ones.
ENV BACKUP_MAX_KEEP=5

COPY Eternia.zip /modpack/Eternia.zip

RUN apt-get update && apt-get install -y --no-install-recommends cron jq unzip \
    && rm -rf /var/lib/apt/lists/*

COPY minecraft/backup.sh     /usr/local/bin/mc-backup
COPY minecraft/death-feed.sh /usr/local/bin/mc-death-feed
COPY minecraft/entrypoint.sh /entrypoint.sh
RUN chmod +x /usr/local/bin/mc-backup /usr/local/bin/mc-death-feed /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
