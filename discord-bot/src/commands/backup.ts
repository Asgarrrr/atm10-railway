import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { withRcon } from "../lib/rcon.ts";
import { messages } from "../messages.ts";
import { embed, getRconConfig } from "./_shared.ts";

export const backupCommand = new SlashCommandBuilder()
  .setName("backup")
  .setDescription("Force une sauvegarde immédiate du monde sur disque")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

export async function handleBackup(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const { backup } = messages;
  const cfg = getRconConfig();

  if (!cfg) {
    await i.editReply({ embeds: [embed.error(backup.noRcon.title, backup.noRcon.description)] });
    return;
  }

  await i.editReply({ embeds: [embed.info(backup.saving.title, backup.saving.description)] });

  try {
    await withRcon(cfg.host, cfg.port, cfg.password, async (r) => {
      await r.send("save-off");
      await r.send("save-all flush");
    });

    // Give the server a moment to finish writing
    await Bun.sleep(5_000);

    await withRcon(cfg.host, cfg.port, cfg.password, (r) => r.send("save-on"));

    await i.editReply({ embeds: [embed.success(backup.success.title, backup.success.description)] });
  } catch (err) {
    await i.editReply({
      embeds: [embed.error(backup.error.title, err instanceof Error ? err.message : backup.error.description)],
    });
  }
}
