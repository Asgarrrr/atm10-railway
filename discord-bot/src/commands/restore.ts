import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { env } from "../env.ts";
import { messages } from "../messages.ts";
import { embed } from "./_shared.ts";

export const restoreCommand = new SlashCommandBuilder()
  .setName("restore")
  .setDescription("Restaure l'inventaire d'un joueur depuis une backup")
  .addStringOption((o) =>
    o.setName("joueur").setDescription("Pseudo exact du joueur").setRequired(true).setMaxLength(16),
  )
  .addStringOption((o) =>
    o
      .setName("backup")
      .setDescription("Timestamp de la backup (laisser vide = dernière backup)")
      .setRequired(false),
  )
  .toJSON();

function restoreApiBase(): string {
  return `http://${env.MC_HOST}:${env.MC_RESTORE_PORT}`;
}

async function fetchBackups(): Promise<string[]> {
  const res = await fetch(`${restoreApiBase()}/backups`);
  const json = (await res.json()) as { backups: string[] };
  return json.backups ?? [];
}

async function triggerRestore(player: string, backup: string): Promise<{ success: boolean; output: string }> {
  const res = await fetch(`${restoreApiBase()}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player, backup }),
  });
  return res.json() as Promise<{ success: boolean; output: string }>;
}

export async function handleRestore(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const { restore } = messages;
  const player = i.options.getString("joueur", true);
  const backupOpt = i.options.getString("backup") ?? "";

  // ── Fetch available backups ───────────────────────────────────────────────
  let backups: string[];
  try {
    backups = await fetchBackups();
  } catch {
    await i.editReply({ embeds: [embed.error(restore.apiError.title, restore.apiError.description)] });
    return;
  }

  if (backups.length === 0) {
    await i.editReply({ embeds: [embed.warning(restore.noBackups.title, restore.noBackups.description)] });
    return;
  }

  const selectedBackup = backupOpt || backups[backups.length - 1];
  const latest = backups[backups.length - 1];

  // ── Confirmation ─────────────────────────────────────────────────────────
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("restore:cancel")
      .setLabel(restore.confirm.cancelButton)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("restore:confirm")
      .setLabel(restore.confirm.confirmButton)
      .setStyle(ButtonStyle.Danger),
  );

  await i.editReply({
    embeds: [
      embed
        .warning(restore.confirm.title, restore.confirm.description(player, selectedBackup))
        .addFields(
          { name: restore.confirm.fields.latest, value: latest, inline: true },
          { name: restore.confirm.fields.available, value: String(backups.length), inline: true },
        ),
    ],
    components: [row],
  });

  const msg = await i.fetchReply();
  let btn: ButtonInteraction;
  try {
    btn = (await msg.awaitMessageComponent({
      filter: (b) => b.user.id === i.user.id,
      time: 30_000,
    })) as ButtonInteraction;
  } catch {
    await i.editReply({
      embeds: [embed.info(restore.expired.title, restore.expired.description)],
      components: [],
    });
    return;
  }

  if (btn.customId === "restore:cancel") {
    await btn.update({
      embeds: [embed.info(restore.cancelled.title, restore.cancelled.description)],
      components: [],
    });
    return;
  }

  await btn.update({
    embeds: [embed.info(restore.inProgress.title, restore.inProgress.description(player))],
    components: [],
  });

  // ── Trigger restore ───────────────────────────────────────────────────────
  let result: { success: boolean; output: string };
  try {
    result = await triggerRestore(player, selectedBackup);
  } catch {
    await i.editReply({ embeds: [embed.error(restore.apiError.title, restore.apiError.description)] });
    return;
  }

  if (result.success) {
    await i.editReply({
      embeds: [embed.success(restore.success.title, restore.success.description(player, selectedBackup))],
    });
  } else {
    await i.editReply({
      embeds: [
        embed
          .error(restore.failed.title, restore.failed.description)
          .setDescription(`\`\`\`\n${result.output.slice(0, 1800)}\n\`\`\``),
      ],
    });
  }
}
