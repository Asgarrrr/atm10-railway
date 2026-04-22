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

export function formatDiscordTimestamp(iso: string | null): string {
  if (!iso) return "N/A";
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(unix) || unix <= 0) return "N/A";
  return `<t:${unix}:f>\n<t:${unix}:R>`;
}

export function profileTitle(profile: PlayerProfile): string {
  const hours = profile.stats.play_time_ticks / 20 / 3600;

  if (profile.stats.completed_advancements >= 120) return "Archiviste du monde";
  if (profile.stats.mob_kills >= 1000) return "Pourfendeur de monstres";
  if (profile.stats.blocks_mined >= 50_000) return "Briseur de pierre";
  if (profile.stats.distance_cm >= 50_000_000) return "Grand voyageur";
  if (profile.stats.deaths >= 40) return "Revenant tenace";
  if (hours >= 72) return "Vétéran d'Eternia";
  return "Aventurier";
}

export function profileSummary(profile: PlayerProfile): string {
  const stats = profile.stats;

  if (stats.completed_advancements >= 120) {
    return "A laissé des traces dans presque chaque recoin du modpack.";
  }
  if (stats.mob_kills >= 1000) {
    return "A taillé sa légende dans les ruines, les donjons et les nuits sans fin.";
  }
  if (stats.blocks_mined >= 50_000) {
    return "A retourné la terre et la roche jusqu'à faire plier le monde.";
  }
  if (stats.distance_cm >= 50_000_000) {
    return "A déjà traversé assez de terrain pour connaître chaque horizon du serveur.";
  }
  if (stats.deaths >= 40) {
    return "Tombe souvent, revient toujours, et finit quand même par avancer.";
  }
  return "Continue d'écrire sa propre chronique dans le monde.";
}

export function profileBadges(profile: PlayerProfile): string[] {
  const hours = profile.stats.play_time_ticks / 20 / 3600;
  const badges: string[] = [];

  if (profile.stats.completed_advancements >= 120) badges.push("Archivist");
  if (profile.stats.mob_kills >= 1000) badges.push("Monster Slayer");
  if (profile.stats.blocks_mined >= 50_000) badges.push("Deep Miner");
  if (profile.stats.distance_cm >= 50_000_000) badges.push("Trailblazer");
  if (profile.stats.jumps >= 10_000) badges.push("Restless Legs");
  if (hours >= 72) badges.push("World Veteran");
  if (profile.stats.deaths >= 40) badges.push("Stubborn Soul");

  return badges;
}
