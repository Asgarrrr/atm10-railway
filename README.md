# Eternia ATM10 on Railway

Personal infrastructure for running our **All the Mods 10** (NeoForge 1.21.1) server on Railway, with a custom Discord bot for server control, backups, inventory restores, and player profiles.

The repository contains two independent Railway services:

- **`Dockerfile`** — the Minecraft server, built on `itzg/minecraft-server:java21`, configured for ATM10 with autopause and RCON.
- **`discord-bot/`** — a Bun/TypeScript Discord bot exposing slash commands to start, stop, restart, and query the server.

---

## Architecture

```
Railway project
├── minecraft        Dockerfile at repo root
│                    itzg/minecraft-server:java21 + NeoForge + ATM10
│                    RCON on :25575 (internal)
│                    MC protocol on :25565 (TCP proxy, public)
│
└── discord-bot      discord-bot/Dockerfile
                     discord.js gateway bot
                     Reaches minecraft via minecraft.railway.internal
```

The two services communicate over Railway's private network. The bot never exposes a public port.

---

## Prerequisites

- A Railway account with the Hobby plan or higher (this workload requires at least 8 GB RAM)
- A CurseForge API key — generate one at [console.curseforge.com](https://console.curseforge.com/)
- A Discord application with a bot token — create one at [discord.com/developers/applications](https://discord.com/developers/applications)

---

## Deployment

### 1. Create the Minecraft service

In your Railway project, create a new service from this repository.

- Root directory: `.` (repo root)
- Set the environment variables listed in the [Minecraft configuration](#minecraft-service) section below.
- Under **Settings → Networking**, enable the TCP proxy on port `25565`. Share the resulting domain and port with your players.
- Under **Settings → Resources**, set the memory limit to at least **10 GB**.

### 2. Create the Discord bot service

Add a second service from the same repository.

- Root directory: `discord-bot`
- Set the environment variables listed in the [Bot configuration](#discord-bot-service) section below.
- No networking configuration is required — the bot connects outbound to Discord and to the Minecraft service over the private network.

---

## Configuration

### Minecraft service

| Variable                 | Required | Default | Description                                                                           |
| ------------------------ | -------- | ------- | ------------------------------------------------------------------------------------- |
| `CF_API_KEY`             | yes      | —       | CurseForge API key, used to download the modpack                                      |
| `RCON_PASSWORD`          | yes      | —       | Password for the RCON interface. Must match `MC_RCON_PASSWORD` on the bot             |
| `CF_FILENAME_MATCHER`    | no       | `6.6`   | ATM10 version to install. Update this to upgrade the modpack                          |
| `INIT_MEMORY`            | no       | `4G`    | JVM initial heap (`-Xms`). Railway bills on RSS, so starting lower saves cost on idle |
| `MEMORY`                 | no       | `8G`    | JVM maximum heap (`-Xmx`)                                                             |
| `VIEW_DISTANCE`          | no       | `6`     | Chunk view distance per player. Raise to 8–10 if RAM allows                           |
| `SIMULATION_DISTANCE`    | no       | `4`     | Entity and redstone tick radius                                                       |
| `AUTOPAUSE_TIMEOUT_EST`  | no       | `300`   | Seconds after the last player disconnects before the JVM is paused                    |
| `AUTOPAUSE_TIMEOUT_INIT` | no       | `600`   | Seconds after startup before pausing if no one has connected                          |

All other variables (`EULA`, `TYPE`, `CF_SLUG`, `USE_AIKAR_FLAGS`, `ENABLE_AUTOPAUSE`, `ENABLE_RCON`, `RCON_PORT`, `MAX_TICK_TIME`, `ENABLE_ROLLING_LOGS`, `JVM_XX_OPTS`) are set in the Dockerfile and do not need to be overridden under normal circumstances.

### Discord bot service

| Variable            | Required | Default                      | Description                                                                              |
| ------------------- | -------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | yes      | —                            | Bot token from the Discord developer portal                                              |
| `DISCORD_CLIENT_ID` | yes      | —                            | Application (client) ID                                                                  |
| `DISCORD_GUILD_ID`  | no       | —                            | If set, slash commands are registered as guild-scoped and update instantly. Recommended  |
| `MC_RCON_PASSWORD`  | yes      | —                            | Must match `RCON_PASSWORD` on the Minecraft service                                      |
| `MC_HOST`           | no       | `minecraft.railway.internal` | Internal hostname of the Minecraft service. Adjust if you renamed the service in Railway |
| `MC_PORT`           | no       | `25565`                      | Minecraft protocol port                                                                  |
| `MC_RCON_PORT`      | no       | `25575`                      | RCON port                                                                                |
| `MC_RCON_HOST`      | no       | same as `MC_HOST`            | RCON hostname, if different from the game port host                                      |

A `.env.example` file is provided in `discord-bot/` as a reference.

---

## Memory sizing

Railway bills on resident set size (RSS), not allocated limits. Setting `INIT_MEMORY` lower than `MEMORY` reduces committed memory during idle periods.

| Players | `INIT_MEMORY` | `MEMORY` | Recommended Railway limit |
| ------- | ------------- | -------- | ------------------------- |
| 1–2     | `3G`          | `6G`     | 8 GB                      |
| 3–6     | `4G`          | `8G`     | 10 GB                     |
| 7–15    | `6G`          | `10G`    | 12 GB                     |
| 15+     | `8G`          | `12G`    | 14 GB                     |

---

## Autopause

When no players are connected, the itzg autopause daemon sends `SIGSTOP` to the JVM, suspending the process. CPU usage drops to near zero. Railway continues to bill for allocated RAM while paused.

A TCP connection attempt to the Minecraft port wakes the server. The Discord bot's `/start` command and players connecting through their client both trigger this transparently. Players will observe a short delay on first connection while the JVM resumes and finishes its tick.

---

## Modpack version

The Dockerfile pins ATM10 to version `6.6` via `CF_FILENAME_MATCHER`. To upgrade, set `CF_FILENAME_MATCHER` to the new version string in Railway Variables (for example `6.7`), then redeploy the service. The itzg image will download the new files on startup and clean up the previous installation.

To pin to an exact CurseForge file ID instead, use `CF_FILE_ID=<id>` and remove `CF_FILENAME_MATCHER`.

Do not remove the version pin on a running world. An unintended modpack update can corrupt saves.

---

## Bot commands

| Command          | Permission    | Description                                                                                    |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `/status`        | everyone      | Reports server state: online/offline, version, player count, latency                           |
| `/start`         | everyone      | Wakes the server if paused, then polls until it responds. Edits the reply when ready           |
| `/stop`          | Manage Guild  | Broadcasts a 15-second warning in game via RCON, then sends `stop`                             |
| `/restart`       | Manage Guild  | Stops the server, waits for it to go offline, then polls until Railway brings it back online   |
| `/players`       | everyone      | Lists connected players. Uses RCON `list` for accuracy if available, falls back to status ping |
| `/profile`       | everyone      | Displays a player's adventure profile from world stats, advancements, and saved player data     |
| `/say <message>` | everyone      | Broadcasts a message in game attributed to the Discord username                                |
| `/cmd <command>` | Administrator | Sends an arbitrary RCON command and returns the response                                       |
| `/backup`        | Manage Guild  | Creates a backup archive immediately and makes it available to `/restore`                      |
| `/restore`       | Manage Guild  | Restores one player's inventory from the latest backup or a chosen backup timestamp            |

`/stop`, `/restart`, `/backup`, and `/restore` require the **Manage Guild** Discord permission. `/cmd` requires **Administrator**.

---

## License

See `LICENSE`.
