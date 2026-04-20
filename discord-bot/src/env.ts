import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // ── Discord ───────────────────────────────────────────────────────────────
    // Bot token from https://discord.com/developers/applications
    DISCORD_TOKEN: z.string().min(1),
    // Application (client) ID
    DISCORD_CLIENT_ID: z.string().min(1),
    // If set, commands are registered as guild-scoped (instant update).
    // Leave unset for global commands (up to 1 hour propagation delay).
    DISCORD_GUILD_ID: z.string().optional(),

    // ── Minecraft server ──────────────────────────────────────────────────────
    // Internal Railway hostname — services in the same project communicate via
    // <service-name>.railway.internal on the private network.
    // Set this to match the name you gave the MC service in Railway.
    MC_HOST: z.string().default("minecraft.railway.internal"),
    MC_PORT: z.string().default("25565"),

    // ── RCON (required for /stop, /say, /cmd, /players) ──────────────────────
    // Enable RCON on the MC service: ENABLE_RCON=true, RCON_PORT=25575
    MC_RCON_HOST: z.string().optional(),   // defaults to MC_HOST if unset
    MC_RCON_PORT: z.string().default("25575"),
    MC_RCON_PASSWORD: z.string().optional(), // must match RCON_PASSWORD on MC service
  },
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
