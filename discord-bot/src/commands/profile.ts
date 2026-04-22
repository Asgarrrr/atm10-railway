import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  type GuildMember,
  type InteractionEditReplyOptions,
  type UserContextMenuCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { messages } from "../messages.ts";
import {
  fetchProfile,
  fetchProfileFromCandidates,
  formatDiscordTimestamp,
  formatDistance,
  formatNumber,
  formatPlayTime,
  isProfileNotFound,
  profileBadges,
  profileSummary,
  profileTitle,
  type PlayerProfile,
} from "../lib/profile.ts";
import { embed } from "./_shared.ts";

type ProfilePage = "overview" | "stats" | "legend";

const PROFILE_PAGES: ProfilePage[] = ["overview", "stats", "legend"];

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

export const profileContextCommand = new ContextMenuCommandBuilder()
  .setName("Minecraft Profile")
  .setType(ApplicationCommandType.User)
  .toJSON();

export async function handleProfile(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const player = i.options.getString("joueur", true);
  await replyWithProfile(i, player, "overview", i.user.id);
}

export async function handleProfileContextMenu(i: UserContextMenuCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const { profile } = messages;
  const candidates = extractProfileCandidates(i);
  const match = await fetchProfileFromCandidates(candidates);

  if (!match) {
    const tried = candidates.length > 0 ? candidates.map((candidate) => `\`${candidate}\``).join(", ") : profile.contextMenu.none;
    await i.editReply({
      embeds: [
        embed.warning(
          profile.contextMenu.notLinked.title,
          profile.contextMenu.notLinked.description(i.targetUser.username, tried),
        ),
      ],
    });
    return;
  }

  await i.editReply(buildProfileReply(match.profile, "overview", i.user.id, profile.contextMenu.matched(match.candidate)));
}

export async function handleProfileButton(i: ButtonInteraction): Promise<void> {
  const parsed = parseProfileButtonId(i.customId);
  if (!parsed) return;

  const { page, player, ownerId } = parsed;
  const { profile } = messages;

  if (ownerId !== i.user.id) {
    await i.reply({
      embeds: [embed.warning(profile.pagination.locked.title, profile.pagination.locked.description)],
      ephemeral: true,
    });
    return;
  }

  await i.deferUpdate();
  await replyWithProfile(i, player, page, ownerId);
}

function buildProfileReply(
  data: PlayerProfile,
  page: ProfilePage,
  ownerId: string,
  note?: string,
): InteractionEditReplyOptions {
  return {
    embeds: [buildProfileEmbed(data, page, note)],
    components: [buildProfileButtons(data.name, page, ownerId)],
  };
}

async function replyWithProfile(
  i: ChatInputCommandInteraction | ButtonInteraction,
  player: string,
  page: ProfilePage,
  ownerId: string,
): Promise<void> {
  const { profile } = messages;

  try {
    const data = await fetchProfile(player);
    await i.editReply(buildProfileReply(data, page, ownerId));
  } catch (error) {
    if (isProfileNotFound(error)) {
      await i.editReply({
        embeds: [embed.warning(profile.notFound.title, profile.notFound.description(player))],
        components: [],
      });
      return;
    }

    await i.editReply({
      embeds: [embed.error(profile.apiError.title, profile.apiError.description)],
      components: [],
    });
  }
}

function buildProfileEmbed(data: PlayerProfile, page: ProfilePage, note?: string) {
  const { profile } = messages;
  const title = profileTitle(data);
  const summary = profileSummary(data);
  const badges = profileBadges(data);

  const e = embed
    .info(profile.title(data.name), profile.description(title, summary))
    .setFooter({ text: `${profile.footer} • ${profile.pages[page]} (${PROFILE_PAGES.indexOf(page) + 1}/${PROFILE_PAGES.length})` });

  if (page === "overview") {
    return e.addFields(
      { name: profile.fields.rank, value: title, inline: true },
      { name: profile.fields.lastSaved, value: formatDiscordTimestamp(data.last_saved_at), inline: true },
      { name: profile.fields.advancements, value: formatNumber(data.stats.completed_advancements), inline: true },
      { name: profile.fields.playTime, value: formatPlayTime(data.stats.play_time_ticks), inline: true },
      { name: profile.fields.distance, value: formatDistance(data.stats.distance_cm), inline: true },
      { name: profile.fields.badges, value: badges.length > 0 ? badges.map((badge) => `• ${badge}`).join("\n") : profile.noBadges, inline: true },
      ...(note ? [{ name: profile.fields.note, value: note }] : []),
    );
  }

  if (page === "stats") {
    return e.addFields(
      {
        name: profile.sections.combat,
        value: [
          `${profile.labels.mobKills}: **${formatNumber(data.stats.mob_kills)}**`,
          `${profile.labels.playerKills}: **${formatNumber(data.stats.player_kills)}**`,
          `${profile.labels.deaths}: **${formatNumber(data.stats.deaths)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: profile.sections.exploration,
        value: [
          `${profile.labels.distance}: **${formatDistance(data.stats.distance_cm)}**`,
          `${profile.labels.blocksMined}: **${formatNumber(data.stats.blocks_mined)}**`,
          `${profile.labels.jumps}: **${formatNumber(data.stats.jumps)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: profile.sections.progress,
        value: [
          `${profile.labels.playTime}: **${formatPlayTime(data.stats.play_time_ticks)}**`,
          `${profile.labels.advancements}: **${formatNumber(data.stats.completed_advancements)}**`,
          `${profile.labels.uuid}: \`${data.uuid}\``,
        ].join("\n"),
      },
    );
  }

  return e.addFields(
    {
      name: profile.sections.legend,
      value: badges.length > 0
        ? badges.map((badge) => `✅ ${badge}`).join("\n")
        : profile.legend.noBadges,
    },
    {
      name: profile.sections.chronicle,
      value: [
        profile.legend.lines.playTime(formatPlayTime(data.stats.play_time_ticks)),
        profile.legend.lines.distance(formatDistance(data.stats.distance_cm)),
        profile.legend.lines.mobs(formatNumber(data.stats.mob_kills)),
        profile.legend.lines.deaths(formatNumber(data.stats.deaths)),
      ].join("\n"),
    },
    {
      name: profile.sections.records,
      value: [
        `${profile.labels.blocksMined}: **${formatNumber(data.stats.blocks_mined)}**`,
        `${profile.labels.jumps}: **${formatNumber(data.stats.jumps)}**`,
        `${profile.labels.lastSaved}: ${formatDiscordTimestamp(data.last_saved_at)}`,
      ].join("\n"),
    },
  );
}

function buildProfileButtons(player: string, page: ProfilePage, ownerId: string) {
  const { profile } = messages;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...PROFILE_PAGES.map((item) =>
      new ButtonBuilder()
        .setCustomId(buildProfileButtonId(item, player, ownerId))
        .setLabel(profile.pages[item])
        .setStyle(item === page ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(item === page),
    ),
  );
}

function buildProfileButtonId(page: ProfilePage, player: string, ownerId: string): string {
  return `profile:${page}:${player}:${ownerId}`;
}

function parseProfileButtonId(customId: string): { page: ProfilePage; player: string; ownerId: string } | null {
  const [prefix, page, player, ownerId] = customId.split(":");
  if (prefix !== "profile" || !PROFILE_PAGES.includes(page as ProfilePage) || !player || !ownerId) return null;
  return { page: page as ProfilePage, player, ownerId };
}

function extractProfileCandidates(i: UserContextMenuCommandInteraction): string[] {
  const rawValues = [
    i.targetUser.username,
    i.targetUser.globalName ?? "",
    getTargetDisplayName(i.targetMember),
  ];

  const candidates = new Set<string>();
  for (const raw of rawValues) {
    for (const candidate of minecraftNameCandidates(raw)) {
      candidates.add(candidate);
    }
  }

  return [...candidates];
}

function getTargetDisplayName(member: UserContextMenuCommandInteraction["targetMember"]): string {
  if (!member || typeof member !== "object") return "";
  if ("displayName" in member && typeof member.displayName === "string") return member.displayName;
  if ("nick" in member && typeof member.nick === "string") return member.nick ?? "";
  if ("nickname" in member && typeof member.nickname === "string") return member.nickname ?? "";
  return "";
}

function minecraftNameCandidates(raw: string): string[] {
  const cleaned = raw.trim();
  if (!cleaned) return [];

  const candidates = new Set<string>();
  if (/^[A-Za-z0-9_]{2,16}$/.test(cleaned)) candidates.add(cleaned);

  for (const match of cleaned.match(/[A-Za-z0-9_]{2,16}/g) ?? []) {
    candidates.add(match);
  }

  return [...candidates];
}
