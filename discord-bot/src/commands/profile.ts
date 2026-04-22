import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  EmbedBuilder,
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
  profilePortraitUrl,
  type PlayerProfile,
} from "../lib/profile.ts";
import { embed } from "./_shared.ts";

type ProfilePage = "overview" | "stats";

const PROFILE_PAGES: ProfilePage[] = ["overview", "stats"];
const PROFILE_PAGE_META: Record<
  ProfilePage,
  { icon: string; author: string; footer: string; buttonLabel: string; color: number }
> = {
  overview: {
    icon: "👤",
    author: "Résumé",
    footer: "Résumé",
    buttonLabel: "Résumé",
    color: 0x2563eb,
  },
  stats: {
    icon: "📊",
    author: "Statistiques",
    footer: "Statistiques",
    buttonLabel: "Stats",
    color: 0x0f766e,
  },
};

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
  const { common, profile } = messages;

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

    console.error("[profile] failed to render profile card", error);

    await i.editReply({
      embeds: [embed.error(common.internalError.title, common.internalError.description)],
      components: [],
    });
  }
}

function buildProfileEmbed(data: PlayerProfile, page: ProfilePage, note?: string) {
  const { profile } = messages;
  const pageMeta = PROFILE_PAGE_META[page];

  const e = new EmbedBuilder()
    .setColor(pageMeta.color)
    .setAuthor({ name: `${pageMeta.icon} ${pageMeta.author}`, iconURL: profilePortraitUrl(data.uuid, 64) })
    .setTitle(data.name)
    .setThumbnail(profilePortraitUrl(data.uuid, 128))
    .setFooter({ text: `Profil joueur • ${pageMeta.footer} (${PROFILE_PAGES.indexOf(page) + 1}/${PROFILE_PAGES.length})` });

  if (data.last_saved_at) {
    e.setTimestamp(new Date(data.last_saved_at));
  }

  if (page === "overview") {
    e.setDescription("Vue synthétique des compteurs du joueur.");

    return e.addFields(
      {
        name: "Identité",
        value: [
          `**Joueur**\n${data.name}`,
          `**${profile.fields.uuid}**\n\`${data.uuid}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Activité",
        value: [
          `**${profile.fields.lastSaved}**\n${formatDiscordTimestamp(data.last_saved_at)}`,
          `**${profile.fields.playTime}**\n${formatPlayTime(data.stats.play_time_ticks)}`,
          `**${profile.fields.advancements}**\n${formatNumber(data.stats.completed_advancements)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Combat",
        value: [
          `**${profile.fields.mobKills}**\n${formatNumber(data.stats.mob_kills)}`,
          `**${profile.fields.playerKills}**\n${formatNumber(data.stats.player_kills)}`,
          `**${profile.fields.deaths}**\n${formatNumber(data.stats.deaths)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Exploration",
        value: [
          `**${profile.fields.distance}**\n${formatDistance(data.stats.distance_cm)}`,
          `**${profile.fields.blocksMined}**\n${formatNumber(data.stats.blocks_mined)}`,
          `**${profile.fields.jumps}**\n${formatNumber(data.stats.jumps)}`,
        ].join("\n"),
      },
      ...(note ? [{ name: profile.fields.note, value: note }] : []),
    );
  }

  e.setDescription("Vue brute des compteurs exposés par l'API.");

  return e.addFields(
    statPanel("Combat", [
      [profile.labels.mobKills, formatNumber(data.stats.mob_kills)],
      [profile.labels.playerKills, formatNumber(data.stats.player_kills)],
      [profile.labels.deaths, formatNumber(data.stats.deaths)],
    ]),
    statPanel("Exploration", [
      [profile.labels.distance, `${formatDistance(data.stats.distance_cm)} (${formatNumber(data.stats.distance_cm)} cm)`],
      [profile.labels.blocksMined, formatNumber(data.stats.blocks_mined)],
      [profile.labels.jumps, formatNumber(data.stats.jumps)],
    ]),
    statPanel("Progression", [
      [profile.labels.playTime, `${formatPlayTime(data.stats.play_time_ticks)} (${formatNumber(data.stats.play_time_ticks)} ticks)`],
      [profile.labels.advancements, formatNumber(data.stats.completed_advancements)],
    ]),
    {
      name: "Technique",
      value: [
        `**${profile.labels.uuid}**: \`${data.uuid}\``,
        `**${profile.labels.lastSaved}**: ${formatDiscordTimestamp(data.last_saved_at)}`,
      ].join("\n"),
    },
    ...(note ? [{ name: profile.fields.note, value: note }] : []),
  );
}

function buildProfileButtons(player: string, page: ProfilePage, ownerId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...PROFILE_PAGES.map((item) =>
      new ButtonBuilder()
        .setCustomId(buildProfileButtonId(item, player, ownerId))
        .setEmoji(PROFILE_PAGE_META[item].icon)
        .setLabel(PROFILE_PAGE_META[item].buttonLabel)
        .setStyle(item === page ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
  );
}

function statPanel(name: string, rows: Array<[string, string]>) {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  return {
    name,
    value: `\`\`\`\n${rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n")}\n\`\`\``,
  };
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
