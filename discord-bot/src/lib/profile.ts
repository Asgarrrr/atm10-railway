import { env } from "../env.ts";

export interface PlayerProfile {
  name: string;
  uuid: string;
  last_saved_at: string | null;
  stats: {
    play_time_ticks: number;
    deaths: number;
    mob_kills: number;
    player_kills: number;
    jumps: number;
    distance_cm: number;
    blocks_mined: number;
    completed_advancements: number;
  };
}

class ProfileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CandidateProfileMatch {
  profile: PlayerProfile;
  candidate: string;
}

function restoreApiBase(): string {
  return `http://${env.MC_HOST}:${env.MC_RESTORE_PORT}`;
}

export async function fetchProfile(player: string): Promise<PlayerProfile> {
  const url = new URL(`${restoreApiBase()}/profile`);
  url.searchParams.set("player", player);

  const res = await fetch(url);
  const json = (await res.json()) as { profile?: PlayerProfile; error?: string };

  if (!res.ok || !json.profile) {
    throw new ProfileApiError(json.error ?? "Impossible de charger le profil.", res.status);
  }

  return json.profile;
}

export function isProfileNotFound(error: unknown): boolean {
  return error instanceof ProfileApiError && error.status === 404;
}

export async function fetchProfileFromCandidates(candidates: string[]): Promise<CandidateProfileMatch | null> {
  const tried = new Set<string>();

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || tried.has(normalized)) continue;
    tried.add(normalized);

    try {
      const profile = await fetchProfile(normalized);
      return { profile, candidate: normalized };
    } catch (error) {
      if (!isProfileNotFound(error)) throw error;
    }
  }

  return null;
}

export function formatPlayTime(ticks: number): string {
  const totalSeconds = Math.floor(ticks / 20);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;

  if (days > 0) return `${days}j ${remHours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes} min`;
  return `${totalSeconds}s`;
}

export function formatDistance(cm: number): string {
  const meters = cm / 100;
  if (meters >= 1000) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
  }
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(meters)} m`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatDecimal(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(value);
}

export function formatDiscordTimestamp(iso: string | null): string {
  if (!iso) return "N/A";
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return "N/A";
  return `<t:${unix}:f>\n<t:${unix}:R>`;
}

export interface ProfileBadge {
  label: string;
  icon: string;
  flavor: string;
}

export interface ProfileRenown {
  score: number;
  tier: string;
  stars: string;
}

function hoursPlayed(profile: PlayerProfile): number {
  return profile.stats.play_time_ticks / 20 / 3600;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function profileTitle(profile: PlayerProfile): string {
  const hours = hoursPlayed(profile);

  if (profile.stats.completed_advancements >= 240) return "Grand archiviste";
  if (profile.stats.completed_advancements >= 120) return "Archiviste du monde";
  if (profile.stats.mob_kills >= 1_500) return "Fléau d'Eternia";
  if (profile.stats.mob_kills >= 750) return "Pourfendeur de monstres";
  if (profile.stats.blocks_mined >= 50_000) return "Briseur de pierre";
  if (profile.stats.distance_cm >= 6_000_000) return "Grand voyageur";
  if (profile.stats.deaths >= 25) return "Âme revenue";
  if (hours >= 48) return "Vétéran d'Eternia";
  return "Aventurier";
}

export function profileSummary(profile: PlayerProfile): string {
  const stats = profile.stats;

  if (stats.completed_advancements >= 240) {
    return "Les archives d'Eternia le citent déjà parmi ceux qui ouvrent le modpack chapitre après chapitre.";
  }
  if (stats.completed_advancements >= 120) {
    return "Chaque système exploré ajoute une nouvelle page au Livre du Monde.";
  }
  if (stats.mob_kills >= 1_500) {
    return "Traverse les zones hostiles comme d'autres traversent leur propre base.";
  }
  if (stats.mob_kills >= 750) {
    return "A taillé sa réputation dans les donjons, les ruines et les nuits sans fin.";
  }
  if (stats.blocks_mined >= 50_000) {
    return "A retourné la terre et la roche jusqu'à faire plier le monde.";
  }
  if (stats.distance_cm >= 6_000_000) {
    return "A déjà traversé assez de terrain pour donner un nom à chaque horizon du serveur.";
  }
  if (stats.deaths >= 25) {
    return "Tombe parfois, revient toujours, et finit quand même par avancer.";
  }
  if (hoursPlayed(profile) >= 48) {
    return "Son passage commence à compter dans la mémoire longue du serveur.";
  }
  return "Continue d'écrire sa propre chronique dans le monde.";
}

export function profileBadges(profile: PlayerProfile): ProfileBadge[] {
  const hours = hoursPlayed(profile);
  const badges: ProfileBadge[] = [];

  if (profile.stats.completed_advancements >= 180) {
    badges.push({
      label: "Archiviste",
      icon: "📚",
      flavor: "A déjà ouvert une large part des systèmes majeurs du modpack.",
    });
  }
  if (profile.stats.mob_kills >= 750) {
    badges.push({
      label: "Fléau nocturne",
      icon: "⚔️",
      flavor: "Les expéditions hostiles laissent derrière elles une vraie traînée de mobs vaincus.",
    });
  }
  if (profile.stats.blocks_mined >= 25_000) {
    badges.push({
      label: "Mineur abyssal",
      icon: "⛏️",
      flavor: "A passé assez de temps sous terre pour faire parler la roche.",
    });
  }
  if (profile.stats.distance_cm >= 6_000_000) {
    badges.push({
      label: "Traceur d'horizons",
      icon: "🧭",
      flavor: "Son pas a déjà laissé une empreinte durable sur les routes du serveur.",
    });
  }
  if (profile.stats.jumps >= 8_000) {
    badges.push({
      label: "Jambes sans repos",
      icon: "🪽",
      flavor: "Impossible de le garder immobile quand il y a quelque chose à découvrir.",
    });
  }
  if (hours >= 48) {
    badges.push({
      label: "Vétéran d'Eternia",
      icon: "👑",
      flavor: "Son temps de jeu suffit déjà à le ranger parmi les figures installées du monde.",
    });
  }
  if (profile.stats.deaths >= 25) {
    badges.push({
      label: "Âme tenace",
      icon: "🛡️",
      flavor: "Tombe, revient, repart : la chronique n'aime pas l'effacer.",
    });
  }

  return badges;
}

export function profileRenown(profile: PlayerProfile): ProfileRenown {
  const hours = hoursPlayed(profile);
  const score = Math.round(clamp(
    Math.min(32, profile.stats.completed_advancements / 8)
      + Math.min(18, profile.stats.mob_kills / 60)
      + Math.min(16, profile.stats.distance_cm / 500_000)
      + Math.min(12, hours / 2)
      + Math.min(12, profile.stats.blocks_mined / 4_000)
      + Math.min(10, profile.stats.jumps / 1_500),
    0,
    100,
  ));

  const tiers = [
    { minimum: 85, label: "Mythique" },
    { minimum: 68, label: "Héroïque" },
    { minimum: 50, label: "Renommé" },
    { minimum: 32, label: "Éprouvé" },
    { minimum: 0, label: "Émergent" },
  ];

  const tier = tiers.find((candidate) => score >= candidate.minimum)?.label ?? "Émergent";
  const filled = clamp(Math.ceil(score / 20), 1, 5);

  return {
    score,
    tier,
    stars: `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`,
  };
}

export function profileDistancePerHour(profile: PlayerProfile): number {
  const hours = hoursPlayed(profile);
  if (hours <= 0) return profile.stats.distance_cm;
  return profile.stats.distance_cm / hours;
}

export function profileAdvancementsPerHour(profile: PlayerProfile): number {
  const hours = hoursPlayed(profile);
  if (hours <= 0) return profile.stats.completed_advancements;
  return profile.stats.completed_advancements / hours;
}

export function profileKillDeathRatio(profile: PlayerProfile): number | null {
  if (profile.stats.deaths <= 0) return profile.stats.mob_kills > 0 ? profile.stats.mob_kills : null;
  return profile.stats.mob_kills / profile.stats.deaths;
}

export function profileCardTitle(name: string): string {
  return /^[AEIOUYaeiouy]/.test(name) ? `Annales d'${name}` : `Annales de ${name}`;
}

export function profileChronicle(profile: PlayerProfile): string[] {
  const renown = profileRenown(profile);
  const lines = [
    `Porte le titre de **${profileTitle(profile)}** avec une renommée **${renown.tier.toLowerCase()}** dans le Livre du Monde.`,
    dominantFeat(profile),
    resilienceLine(profile),
    `Son rythme actuel atteint **${formatDistance(profileDistancePerHour(profile))} / h** et **${formatDecimal(profileAdvancementsPerHour(profile))} advancements / h**.`,
  ];

  return lines;
}

function dominantFeat(profile: PlayerProfile): string {
  const candidates = [
    {
      score: profile.stats.completed_advancements * 2.5,
      line: `A déjà validé **${formatNumber(profile.stats.completed_advancements)}** advancements, de quoi ouvrir une vraie place dans les archives.`,
    },
    {
      score: profile.stats.mob_kills,
      line: `A laissé **${formatNumber(profile.stats.mob_kills)}** créatures hostiles derrière lui au fil des expéditions.`,
    },
    {
      score: profile.stats.distance_cm / 10_000,
      line: `A parcouru **${formatDistance(profile.stats.distance_cm)}** et continue d'étendre son territoire connu.`,
    },
    {
      score: profile.stats.blocks_mined / 10,
      line: `A déjà extrait **${formatNumber(profile.stats.blocks_mined)}** blocs, assez pour marquer profondément le terrain.`,
    },
  ];

  return candidates.sort((left, right) => right.score - left.score)[0]?.line
    ?? "Continue de tracer sa route sans encore avoir révélé sa spécialité.";
}

function resilienceLine(profile: PlayerProfile): string {
  if (profile.stats.deaths === 0 && profile.stats.mob_kills > 0) {
    return "N'a pas encore connu de vraie chute malgré des combats déjà sérieux.";
  }

  const ratio = profileKillDeathRatio(profile);
  if (ratio !== null && ratio >= 20) {
    return "Tombe parfois, mais fait payer chaque chute bien au-delà du raisonnable.";
  }
  if (profile.stats.deaths >= 25) {
    return "Revient toujours malgré les revers, ce qui lui vaut déjà une solide réputation de survivant.";
  }
  if (profile.stats.mob_kills >= 300) {
    return "A trouvé un équilibre entre prise de risque et instinct de survie.";
  }

  return "Sa chronique reste encore ouverte, mais le ton est déjà donné.";
}
