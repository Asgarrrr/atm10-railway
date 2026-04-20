import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { getStatus } from "../lib/mc.ts";
import { messages } from "../messages.ts";
import { embed, getRconConfig, getRailwayConfig } from "./_shared.ts";

export const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Affiche l'état actuel du serveur Minecraft")
  .toJSON();

export async function handleStatus(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  const s = await getStatus();
  const { status } = messages;

  if (!s.online) {
    const canStart = !!(getRailwayConfig() || getRconConfig());
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("panel:start")
        .setLabel(status.buttons.start)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canStart),
    );
    await i.editReply({
      embeds: [embed.error(status.offline.title, status.offline.description)],
      components: [row],
    });
    return;
  }

  const statusEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(status.online.title)
    .addFields(
      { name: status.fields.version, value: s.version ?? messages.common.unknownVersion,                 inline: true },
      { name: status.fields.players, value: `${s.players.online} / ${s.players.max}`,                    inline: true },
      { name: status.fields.latency, value: s.latency !== null ? `${s.latency} ms` : messages.common.notAvailable, inline: true },
    );

  if (s.motd) statusEmbed.setDescription(`*${s.motd}*`);
  if (s.players.list.length > 0) {
    statusEmbed.addFields({
      name:  status.fields.connected,
      value: s.players.list.map((p) => `• ${p}`).join("\n"),
    });
  }

  const hasRcon = !!getRconConfig();
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("panel:restart")
      .setLabel(status.buttons.restart)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasRcon),
    new ButtonBuilder()
      .setCustomId("panel:stop")
      .setLabel(status.buttons.stop)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasRcon),
  );

  await i.editReply({ embeds: [statusEmbed], components: [row] });
}
