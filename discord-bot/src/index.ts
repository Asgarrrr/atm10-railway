import { ActivityType, Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { env } from "./env.ts";
import { COMMANDS, handleCommand } from "./commands/index.ts";

// ── Register slash commands ───────────────────────────────────────────────────
//
// If DISCORD_GUILD_ID is set, commands are registered as guild-scoped and
// appear instantly. Without it they are global (up to 1 hour propagation).

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

await rest.put(route, { body: COMMANDS });

console.log(
  env.DISCORD_GUILD_ID
    ? `✅ Slash commands registered in guild ${env.DISCORD_GUILD_ID}`
    : "✅ Global slash commands registered (may take up to 1 h to appear)",
);

// ── Discord client ────────────────────────────────────────────────────────────
//
// We only need the Guilds intent — the bot responds to slash command
// interactions and does not read messages or guild member data.

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Logged in as ${c.user.tag}`);
  c.user.setActivity("All the Mods 10", { type: ActivityType.Playing });
});

client.on(Events.InteractionCreate, (interaction) => {
  // handleCommand is async but discord.js does not await the event listener.
  // We catch unhandled rejections here so they surface in Railway logs.
  handleCommand(interaction).catch((err) => {
    console.error("Unhandled rejection in InteractionCreate:", err);
  });
});

client.login(env.DISCORD_TOKEN);
