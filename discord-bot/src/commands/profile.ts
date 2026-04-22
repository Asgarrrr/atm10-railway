import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { messages } from "../messages.ts";
import {
  fetchProfile,
  formatDiscordTimestamp,
  formatDistance,
  formatNumber,
  formatPlayTime,
  isProfileNotFound,
  profileSummary,
  profileTitle,
} from "../lib/profile.ts";
import { embed } from "./_shared.ts";

export const profileCommand = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Affiche la fiche d'aventure d'un joueur")
  .addStringOption((o) =>
    o
      .setName("joueur")
      .setDescription("Pseudo exact du joueur")
      .setRequired(true)
      .setMaxLength(16),
  )
  .toJSON();

export async function handleProfile(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const { profile } = messages;
  const player = i.options.getString("joueur", true);

  try {
    const data = await fetchProfile(player);
    const title = profileTitle(data);
    const summary = profileSummary(data);

    await i.editReply({
      embeds: [
        embed
          .info(profile.title(data.name), profile.description(title, summary))
          .addFields(
            { name: profile.fields.title, value: title, inline: true },
            { name: profile.fields.advancements, value: formatNumber(data.stats.completed_advancements), inline: true },
            { name: profile.fields.lastSaved, value: formatDiscordTimestamp(data.last_saved_at), inline: true },
            { name: profile.fields.playTime, value: formatPlayTime(data.stats.play_time_ticks), inline: true },
            { name: profile.fields.deaths, value: formatNumber(data.stats.deaths), inline: true },
            { name: profile.fields.mobKills, value: formatNumber(data.stats.mob_kills), inline: true },
            { name: profile.fields.playerKills, value: formatNumber(data.stats.player_kills), inline: true },
            { name: profile.fields.distance, value: formatDistance(data.stats.distance_cm), inline: true },
            { name: profile.fields.blocksMined, value: formatNumber(data.stats.blocks_mined), inline: true },
            { name: profile.fields.jumps, value: formatNumber(data.stats.jumps), inline: true },
            { name: profile.fields.uuid, value: `\`${data.uuid}\`` },
          )
          .setFooter({ text: profile.footer }),
      ],
    });
  } catch (error) {
    if (isProfileNotFound(error)) {
      await i.editReply({
        embeds: [embed.warning(profile.notFound.title, profile.notFound.description(player))],
      });
      return;
    }

    await i.editReply({
      embeds: [embed.error(profile.apiError.title, profile.apiError.description)],
    });
  }
}
