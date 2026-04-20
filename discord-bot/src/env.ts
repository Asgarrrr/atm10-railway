import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN:     z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID:  z.string().optional(),

  MC_HOST:          z.string().default("minecraft.railway.internal"),
  MC_PORT:          z.string().default("25565"),
  MC_RCON_HOST:     z.string().optional(),
  MC_RCON_PORT:     z.string().default("25575"),
  MC_RCON_PASSWORD: z.string().optional(),

  // ── Railway API integration (all optional) ────────────────────────────────
  // When present, /start, /stop and /restart make direct Railway API calls to
  // truly start/stop the Minecraft service rather than relying on autopause or
  // the restart policy alone.
  //
  // RAILWAY_API_TOKEN      – personal token from railway.com/account/tokens
  // RAILWAY_MC_SERVICE_ID  – service ID of the Minecraft Railway service
  // RAILWAY_ENVIRONMENT_ID – environment ID (the UUID shown in Railway URLs;
  //                          usually the "production" environment)
  RAILWAY_API_TOKEN:       z.string().optional(),
  RAILWAY_MC_SERVICE_ID:   z.string().optional(),
  RAILWAY_ENVIRONMENT_ID:  z.string().optional(),
});

const _env = schema.safeParse(
  Object.fromEntries(
    Object.entries(Bun.env).filter(([, v]) => v !== ""),
  ),
);

if (!_env.success) {
  const lines = _env.error.issues.map(
    (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
  );
  throw new Error(`Invalid environment variables:\n${lines.join("\n")}`);
}

export const env = _env.data;
