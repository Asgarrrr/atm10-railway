import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { withRcon } from "../lib/rcon.ts";
import { messages } from "../messages.ts";
import { embed, getRconConfig } from "./_shared.ts";

export const opCommand = new SlashCommandBuilder()
  .setName("op")
  .setDescription("Donne (ou retire) les droits administrateur à un joueur")
  .addStringOption((o) =>
    o
      .setName("joueur")
      .setDescription("Pseudo exact du joueur")
      .setRequired(true)
      .setMaxLength(16),
  )
  .addBooleanOption((o) =>
    o
      .setName("retirer")
      .setDescription("Retirer les droits op au lieu de les donner (défaut : false)")
      .setRequired(false),
  )
  .toJSON();

export async function handleOp(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const { op } = messages;
  const player = i.options.getString("joueur", true);
  const remove = i.options.getBoolean("retirer") ?? false;
  const cfg = getRconConfig();

  if (!cfg) {
    await i.editReply({ embeds: [embed.error(op.noRcon.title, op.noRcon.description)] });
    return;
  }

  const command = remove ? `deop ${player}` : `op ${player}`;

  try {
    const result = await withRcon(cfg.host, cfg.port, cfg.password, (r) => r.send(command));
    const output = result.trim() || (remove ? op.deopSuccess(player) : op.opSuccess(player));

    await i.editReply({
      embeds: [embed.success(remove ? op.deopTitle : op.opTitle, output)],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed.error(op.errorTitle, err instanceof Error ? err.message : op.errorDescription)],
    });
  }
}
