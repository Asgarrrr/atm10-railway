import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { env } from "../env.ts";
import { messages } from "../messages.ts";
import { embed } from "./_shared.ts";

export const backupCommand = new SlashCommandBuilder()
  .setName("backup")
  .setDescription("Crée une backup immédiate du monde")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

function restoreApiBase(): string {
  return `http://${env.MC_HOST}:${env.MC_RESTORE_PORT}`;
}

async function triggerBackup(): Promise<{ success: boolean; output: string; backup?: string | null }> {
  const res = await fetch(`${restoreApiBase()}/backup`, {
    method: "POST",
  });
  return res.json() as Promise<{ success: boolean; output: string; backup?: string | null }>;
}

export async function handleBackup(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const { backup } = messages;

  await i.editReply({ embeds: [embed.info(backup.saving.title, backup.saving.description)] });

  try {
    const result = await triggerBackup();

    if (result.success) {
      await i.editReply({
        embeds: [embed.success(backup.success.title, backup.success.description(result.backup ?? "inconnue"))],
      });
      return;
    }

    await i.editReply({
      embeds: [
        embed
          .error(backup.error.title, backup.error.description)
          .setDescription(`\`\`\`\n${result.output.slice(0, 1800)}\n\`\`\``),
      ],
    });
  } catch {
    await i.editReply({
      embeds: [embed.error(backup.apiError.title, backup.apiError.description)],
    });
  }
}
