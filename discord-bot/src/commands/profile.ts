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
  formatDecimal,
  fetchProfile,
  fetchProfileFromCandidates,
  formatDiscordTimestamp,
  formatDistance,
  formatNumber,
  formatPlayTime,
  isProfileNotFound,
  profileAdvancementsPerHour,
  profileArchetype,
  profileAxes,
  profileBadges,
  profileChronicle,
  profileDistancePerHour,
  profileKillDeathRatio,
  profileMeter,
  profileNextMilestone,
  profilePortraitUrl,
  profileRenown,
  profileSummary,
  profileTitle,
  type PlayerProfile,
} from "../lib/profile.ts";
import { embed } from "./_shared.ts";

type ProfilePage = "overview" | "stats" | "legend";

const PROFILE_PAGES: ProfilePage[] = ["overview", "stats", "legend"];
const PROFILE_PAGE_META: Record<
  ProfilePage,
  { icon: string; author: string; footer: string; buttonLabel: string; color: number }
> = {
  overview: {
    icon: "✦",
    author: "Identité",
    footer: "Identité",
    buttonLabel: "Aura",
    color: 0x2563eb,
  },
  stats: {
    icon: "⚔️",
    author: "Registre brut",
    footer: "Registre brut",
    buttonLabel: "Registre",
    color: 0xea580c,
  },
  legend: {
    icon: "📜",
    author: "Lecture de style",
    footer: "Lecture de style",
    buttonLabel: "Lecture",
    color: 0xca8a04,
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
  const renown = profileRenown(data);
  const archetype = profileArchetype(data);
  const axes = profileAxes(data);
  const milestone = profileNextMilestone(data);
  const pageMeta = PROFILE_PAGE_META[page];
  const distinctions = badges.length > 0
    ? badges.map((badge) => `${badge.icon} ${badge.label}`).join(" • ")
    : profile.noBadges;

  const e = new EmbedBuilder()
    .setColor(pageMeta.color)
    .setAuthor({ name: `${pageMeta.icon} ${pageMeta.author}`, iconURL: profilePortraitUrl(data.uuid, 64) })
    .setTitle(`${data.name} // ${archetype.name}`)
    .setThumbnail(profilePortraitUrl(data.uuid, 128))
    .setFooter({ text: `Profil d'aventure • ${pageMeta.footer} (${PROFILE_PAGES.indexOf(page) + 1}/${PROFILE_PAGES.length})` });

  if (data.last_saved_at) {
    e.setTimestamp(new Date(data.last_saved_at));
  }

  if (page === "overview") {
    e.setDescription([
      `**${title}**`,
      `${renown.stars} **${renown.tier}** • ${summary}`,
      `Focus: **${archetype.focus}**`,
    ].join("\n"));

    return e.addFields(
      {
        name: "✦ Signature",
        value: [
          `**Titre**\n${title}`,
          `**Archetype**\n${archetype.name}`,
          `**Renommée**\n${renown.tier} (${renown.score}/100)`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Fenêtre active",
        value: [
          `**${profile.fields.lastSaved}**\n${formatDiscordTimestamp(data.last_saved_at)}`,
          `**${profile.fields.playTime}**\n${formatPlayTime(data.stats.play_time_ticks)}`,
          `**Cadence**\n${formatDecimal(profileAdvancementsPerHour(data))} adv/h`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Prochaine bascule",
        value: [
          milestone
            ? `${milestone.icon} **${milestone.label}**`
            : "Aucune bascule proche",
          milestone
            ? `${profileMeter(Math.round((milestone.current / milestone.target) * 100))} ${Math.round((milestone.current / milestone.target) * 100)}%`
            : "██████████ 100%",
          milestone
            ? `Encore **${milestone.formatter(milestone.remaining)}**`
            : "Le profil est déjà haut sur plusieurs seuils.",
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Lecture rapide",
        value: profileChronicle(data).slice(0, 3).map((line) => `• ${line}`).join("\n"),
      },
      {
        name: "✦ Distinctions en vitrine",
        value: badges.length > 0
          ? badges.slice(0, 4).map((badge) => `${badge.icon} **${badge.label}**`).join("\n")
          : profile.noBadges,
      },
      ...(note ? [{ name: profile.fields.note, value: note }] : []),
    );
  }

  if (page === "stats") {
    e.setDescription("Registre brut. Ici, pas de roman: uniquement les compteurs qui structurent la campagne.");

    return e.addFields(
      statPanel("⚔️ Registre de combat", [
        [profile.labels.mobKills, formatNumber(data.stats.mob_kills)],
        [profile.labels.playerKills, formatNumber(data.stats.player_kills)],
        [profile.labels.deaths, formatNumber(data.stats.deaths)],
        ["Kills / mort", formatKillDeathRatio(data)],
      ]),
      statPanel("🧭 Registre d'exploration", [
        [profile.labels.distance, formatDistance(data.stats.distance_cm)],
        [profile.labels.blocksMined, formatNumber(data.stats.blocks_mined)],
        [profile.labels.jumps, formatNumber(data.stats.jumps)],
        ["Distance / heure", formatDistance(profileDistancePerHour(data))],
      ]),
      statPanel("⏳ Registre de progression", [
        [profile.labels.playTime, formatPlayTime(data.stats.play_time_ticks)],
        [profile.labels.advancements, formatNumber(data.stats.completed_advancements)],
        ["Adv. / heure", formatDecimal(profileAdvancementsPerHour(data))],
        ["Renommée", `${renown.tier} ${renown.score}/100`],
      ]),
      {
        name: "✦ Lecture chiffrée",
        value: [
          `**Distance / heure**: ${formatDistance(profileDistancePerHour(data))}`,
          `**Kills / mort**: ${formatKillDeathRatio(data)}`,
          `**UUID**: \`${data.uuid}\``,
        ].join("\n"),
      },
    );
  }

  e.setDescription("Lecture de style. Cette page évite les chiffres bruts et essaie de dire comment le joueur avance réellement.");

  return e.addFields(
    {
      name: "📈 Carte des axes",
      value: `\`\`\`\n${axes.map((axis) => `${axis.icon} ${axis.label.padEnd(12)} ${profileMeter(axis.score)} ${String(axis.score).padStart(3)}`).join("\n")}\n\`\`\``,
    },
    {
      name: "🧠 Notes du scribe",
      value: profileChronicle(data).map((line) => `• ${line}`).join("\n"),
    },
    {
      name: "🏅 Distinctions",
      value: badges.length > 0
        ? badges.map((badge) => `${badge.icon} **${badge.label}** — ${badge.flavor}`).join("\n")
        : profile.legend.noBadges,
    },
    {
      name: "🎯 Point de tension",
      value: milestone
        ? `${milestone.icon} **${milestone.label}**\nEncore ${milestone.formatter(milestone.remaining)} avant le prochain palier visible.`
        : "Le profil n'a pas de palier proche évident pour l'instant.",
    },
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

function formatKillDeathRatio(profile: PlayerProfile): string {
  const ratio = profileKillDeathRatio(profile);
  if (ratio === null) return "N/A";
  if (profile.stats.deaths === 0) return "Sans chute";
  return formatDecimal(ratio);
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
