import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { withRcon } from "../lib/rcon.ts";
import { messages } from "../messages.ts";
import { embed, getRconConfig } from "./_shared.ts";

export const cmdCommand = new SlashCommandBuilder()
  .setName("cmd")
  .setDescription("Exécute une commande RCON arbitraire (admin uniquement)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o
      .setName("commande")
      .setDescription("Commande à exécuter (sans le /)")
      .setRequired(true)
      .setMaxLength(500),
  )
  .toJSON();

export async function handleCmd(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const { cmd } = messages;
  const command = i.options.getString("commande", true);
  const cfg = getRconConfig();

  if (!cfg) {
    await i.editReply(cmd.noRcon);
    return;
  }

  try {
    const result = await withRcon(cfg.host, cfg.port, cfg.password, (r) => r.send(command));
    const output = result.trim() || cmd.noResponse;

    await i.editReply({
      embeds: [embed.info(`> ${command}`).setDescription(`\`\`\`\n${output.slice(0, 1900)}\n\`\`\``)],
    });
  } catch (err) {
    await i.editReply(cmd.rconError(err instanceof Error ? err.message : "Erreur inconnue."));
  }
}
