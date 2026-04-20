import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getStatus } from "../lib/mc.ts";
import { withRcon } from "../lib/rcon.ts";
import { messages } from "../messages.ts";
import { embed, getRconConfig } from "./_shared.ts";

export const playersCommand = new SlashCommandBuilder()
  .setName("players")
  .setDescription("Liste les joueurs actuellement connectés")
  .toJSON();

export async function handlePlayers(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const s = await getStatus();
  const { players } = messages;

  if (!s.online) {
    await i.editReply({ embeds: [embed.error(players.offline.title)] });
    return;
  }

  if (s.players.online === 0) {
    await i.editReply({ embeds: [embed.info(players.noPlayers.title, players.noPlayers.description)] });
    return;
  }

  // The status ping caps the sample list at 12 players by default.
  // RCON `list` is accurate for larger servers.
  let playerList = s.players.list;

  const cfg = getRconConfig();
  if (cfg) {
    try {
      const raw = await withRcon(cfg.host, cfg.port, cfg.password, (r) => r.send("list"));
      // "There are X of a max of Y players online: Alice, Bob, Charlie"
      const match = raw.match(/players\s+online:?\s*(.+)$/i);
      if (match?.[1]) {
        const parsed = match[1]
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
        if (parsed.length > 0) playerList = parsed;
      }
    } catch {
      // Fall back to the ping list
    }
  }

  const playersEmbed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(players.title(s.players.online, s.players.max))
    .setDescription(
      playerList.length > 0
        ? playerList.map((p) => `\`${p}\``).join("\n")
        : players.noList,
    );

  await i.editReply({ embeds: [playersEmbed] });
}
