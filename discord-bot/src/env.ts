import { z } from "zod";

const schema = z.object({
  // ── Discord ─────────────────────────────────────────────────────────────────
  DISCORD_TOKEN:     z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID:  z.string().optional(),

  // ── Minecraft server ────────────────────────────────────────────────────────
  MC_HOST: z.string().default("minecraft.railway.internal"),
  MC_PORT: z.string().default("25565"),

  // ── RCON ────────────────────────────────────────────────────────────────────
  MC_RCON_HOST:     z.string().optional(),
  MC_RCON_PORT:     z.string().default("25575"),
  MC_RCON_PASSWORD: z.string().optional(),
});

const _env = schema.safeParse(
  // Strip empty strings so optional vars behave like they are absent.
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
