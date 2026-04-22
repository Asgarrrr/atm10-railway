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

export interface ProfileAxis {
  key: "systems" | "exploration" | "combat" | "resilience";
  label: string;
  icon: string;
  score: number;
}

export interface ProfileArchetype {
  name: string;
  focus: string;
  stance: string;
}

export interface ProfileMilestone {
  label: string;
  icon: string;
  current: number;
  target: number;
  remaining: number;
  formatter: (value: number) => string;
}

function hoursPlayed(profile: PlayerProfile): number {
  return profile.stats.play_time_ticks / 20 / 3600;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function profileTitle(profile: PlayerProfile): string {
  const hours = hoursPlayed(profile);

  if (profile.stats.completed_advancements >= 250) return "Grand archiviste";
  if (profile.stats.completed_advancements >= 120) return "Archiviste du monde";
  if (profile.stats.mob_kills >= 1_500) return "Fléau d'Eternia";
  if (profile.stats.mob_kills >= 750) return "Pourfendeur de monstres";
  if (profile.stats.blocks_mined >= 25_000) return "Briseur de pierre";
  if (profile.stats.distance_cm >= 7_500_000) return "Grand voyageur";
  if (profile.stats.deaths >= 25) return "Âme revenue";
  if (hours >= 48) return "Vétéran d'Eternia";
  return "Aventurier";
}

export function profileSummary(profile: PlayerProfile): string {
  const archetype = profileArchetype(profile);
  return `${archetype.name} • ${archetype.stance}`;
}

export function profileBadges(profile: PlayerProfile): ProfileBadge[] {
  const hours = hoursPlayed(profile);
  const badges: ProfileBadge[] = [];

  if (profile.stats.completed_advancements >= 180) {
    badges.push({
      label: "Archiviste",
      icon: "📚",
      flavor: "Déverrouille les systèmes plus vite qu'il n'installe une routine.",
    });
  }
  if (profile.stats.mob_kills >= 750) {
    badges.push({
      label: "Fléau nocturne",
      icon: "⚔️",
      flavor: "Quand il sort, les zones hostiles le remarquent.",
    });
  }
  if (profile.stats.blocks_mined >= 25_000) {
    badges.push({
      label: "Mineur abyssal",
      icon: "⛏️",
      flavor: "Passe assez de temps sous terre pour faire parler la roche.",
    });
  }
  if (profile.stats.distance_cm >= 7_500_000) {
    badges.push({
      label: "Traceur d'horizons",
      icon: "🧭",
      flavor: "Laisse une vraie empreinte sur les routes du serveur.",
    });
  }
  if (profile.stats.jumps >= 8_000) {
    badges.push({
      label: "Jambes sans repos",
      icon: "🪽",
      flavor: "Impossible de le garder immobile quand il y a quelque chose à ouvrir.",
    });
  }
  if (hours >= 48) {
    badges.push({
      label: "Vétéran d'Eternia",
      icon: "👑",
      flavor: "Assez d'heures pour compter dans la mémoire longue du serveur.",
    });
  }
  if (profile.stats.deaths >= 25) {
    badges.push({
      label: "Âme tenace",
      icon: "🛡️",
      flavor: "Tombe, revient, repart. La chute ne change pas la direction.",
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
  return `${name} // Dossier d'aventure`;
}

export function profileChronicle(profile: PlayerProfile): string[] {
  const archetype = profileArchetype(profile);
  const notes = profileFieldNotes(profile);
  const milestone = profileNextMilestone(profile);

  return [
    `Lecture dominante : **${archetype.name}**. ${archetype.stance}`,
    dominantFeat(profile),
    notes[2] ?? resilienceLine(profile),
    milestone
      ? `Prochaine bascule : **${milestone.label}** dans ${milestone.formatter(milestone.remaining)}.`
      : "Aucune bascule proche : le profil est déjà très haut dans plusieurs axes.",
  ];
}

function dominantFeat(profile: PlayerProfile): string {
  const candidates = [
    {
      score: profile.stats.completed_advancements * 2.5,
      line: `Son point fort reste le déverrouillage : **${formatNumber(profile.stats.completed_advancements)}** advancements déjà tombés.`,
    },
    {
      score: profile.stats.mob_kills,
      line: `Le front monte vite : **${formatNumber(profile.stats.mob_kills)}** créatures hostiles déjà sorties du tableau.`,
    },
    {
      score: profile.stats.distance_cm / 10_000,
      line: `Son terrain de jeu reste large : **${formatDistance(profile.stats.distance_cm)}** déjà couverts.`,
    },
    {
      score: profile.stats.blocks_mined / 10,
      line: `La matière suit : **${formatNumber(profile.stats.blocks_mined)}** blocs déjà extraits.`,
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

export function profileAxes(profile: PlayerProfile): ProfileAxis[] {
  const ratio = profileKillDeathRatio(profile) ?? 0;
  const hours = hoursPlayed(profile);

  const axes: ProfileAxis[] = [
    {
      key: "systems",
      label: "Systèmes",
      icon: "📚",
      score: Math.round(clamp(
        Math.min(52, profile.stats.completed_advancements / 5)
          + Math.min(24, profile.stats.blocks_mined / 1_500)
          + Math.min(24, hours * 0.9),
        0,
        100,
      )),
    },
    {
      key: "exploration",
      label: "Exploration",
      icon: "🧭",
      score: Math.round(clamp(
        Math.min(44, profile.stats.distance_cm / 220_000)
          + Math.min(22, profile.stats.jumps / 420)
          + Math.min(34, profile.stats.completed_advancements / 7),
        0,
        100,
      )),
    },
    {
      key: "combat",
      label: "Combat",
      icon: "⚔️",
      score: Math.round(clamp(
        Math.min(58, profile.stats.mob_kills / 18)
          + Math.min(18, profile.stats.player_kills * 10)
          + Math.min(24, ratio * 4),
        0,
        100,
      )),
    },
    {
      key: "resilience",
      label: "Résilience",
      icon: "🛡️",
      score: Math.round(clamp(
        Math.min(34, profile.stats.deaths * 1.1)
          + Math.min(34, hours * 0.85)
          + Math.min(32, ratio * 3),
        0,
        100,
      )),
    },
  ];

  return axes.sort((left, right) => right.score - left.score);
}

export function profileArchetype(profile: PlayerProfile): ProfileArchetype {
  const [first, second] = profileAxes(profile);
  const pair = `${first?.key ?? "systems"}:${second?.key ?? "exploration"}`;

  switch (pair) {
    case "systems:exploration":
    case "exploration:systems":
      return {
        name: "Chasseur d'archives",
        focus: "Systèmes / Exploration",
        stance: "Déverrouille large, explore vite, et préfère ouvrir des possibilités plutôt que boucler une seule routine.",
      };
    case "combat:exploration":
    case "exploration:combat":
      return {
        name: "Éclaireur de front",
        focus: "Exploration / Combat",
        stance: "Avance par zones, dimensions et affrontements. Le terrain et le danger vont ensemble.",
      };
    case "combat:resilience":
    case "resilience:combat":
      return {
        name: "Briseur de ligne",
        focus: "Combat / Résilience",
        stance: "Encaisse, repart, et transforme la pression en progression.",
      };
    case "systems:resilience":
    case "resilience:systems":
      return {
        name: "Ingénieur tenace",
        focus: "Systèmes / Résilience",
        stance: "Préfère les boucles solides, les setups durables et les retours propres après l'échec.",
      };
    case "systems:combat":
    case "combat:systems":
      return {
        name: "Conquérant de systèmes",
        focus: "Systèmes / Combat",
        stance: "Monte en puissance par l'ouverture de contenu, puis l'impose sur le terrain.",
      };
    case "exploration:resilience":
    case "resilience:exploration":
      return {
        name: "Marcheur obstiné",
        focus: "Exploration / Résilience",
        stance: "Va loin, tombe parfois, mais ne coupe presque jamais sa trajectoire.",
      };
    default:
      return {
        name: "Aventurier composite",
        focus: `${first?.label ?? "Progression"} / ${second?.label ?? "Lecture"}`,
        stance: "Ne rentre pas encore dans une seule case nette, ce qui est souvent bon signe sur un modpack large.",
      };
  }
}

export function profileFieldNotes(profile: PlayerProfile): string[] {
  const archetype = profileArchetype(profile);
  const advRate = profileAdvancementsPerHour(profile);
  const distanceRate = profileDistancePerHour(profile);
  const deathsPerHour = hoursPlayed(profile) <= 0 ? 0 : profile.stats.deaths / hoursPlayed(profile);
  const ratio = profileKillDeathRatio(profile);

  const notes = [
    `Focus principal : **${archetype.focus}**.`,
    advRate >= 10
      ? "Cadence forte : le profil débloque de nouveaux pans du modpack à un rythme soutenu."
      : advRate >= 5
        ? "Cadence solide : la progression avance régulièrement sans se disperser."
        : "Cadence posée : la progression prend son temps et capitalise sur la durée.",
    distanceRate >= 800_000
      ? "Mobilité élevée : il couvre du terrain vite et transforme le mouvement en progression."
      : distanceRate >= 350_000
        ? "Mobilité stable : il explore assez pour garder le monde ouvert autour de lui."
        : "Ancrage fort : le profil progresse davantage par installation que par grands déplacements.",
  ];

  if (ratio !== null && ratio >= 18) {
    notes.push("Lecture de risque : très agressif, mais rarement gratuit. Le combat reste rentable.");
  } else if (deathsPerHour >= 2) {
    notes.push("Lecture de risque : accepte clairement la chute comme coût normal d'avancée.");
  } else if (profile.stats.deaths === 0) {
    notes.push("Lecture de risque : propre. Rien n'indique une prise de risque mal calibrée.");
  } else {
    notes.push("Lecture de risque : mesuré. L'échec existe, mais il ne dicte pas le rythme.");
  }

  return notes;
}

export function profileNextMilestone(profile: PlayerProfile): ProfileMilestone | null {
  const thresholds: ProfileMilestone[] = [
    {
      label: "300 advancements",
      icon: "📚",
      current: profile.stats.completed_advancements,
      target: 300,
      remaining: Math.max(0, 300 - profile.stats.completed_advancements),
      formatter: (value) => `${formatNumber(value)} advancements`,
    },
    {
      label: "1 000 mobs éliminés",
      icon: "⚔️",
      current: profile.stats.mob_kills,
      target: 1_000,
      remaining: Math.max(0, 1_000 - profile.stats.mob_kills),
      formatter: (value) => `${formatNumber(value)} mobs`,
    },
    {
      label: "75 km de terrain couvert",
      icon: "🧭",
      current: profile.stats.distance_cm,
      target: 7_500_000,
      remaining: Math.max(0, 7_500_000 - profile.stats.distance_cm),
      formatter: (value) => formatDistance(value),
    },
    {
      label: "1 000 blocs minés",
      icon: "⛏️",
      current: profile.stats.blocks_mined,
      target: 1_000,
      remaining: Math.max(0, 1_000 - profile.stats.blocks_mined),
      formatter: (value) => `${formatNumber(value)} blocs`,
    },
    {
      label: "9 000 sauts",
      icon: "🪽",
      current: profile.stats.jumps,
      target: 9_000,
      remaining: Math.max(0, 9_000 - profile.stats.jumps),
      formatter: (value) => `${formatNumber(value)} sauts`,
    },
    {
      label: "48 heures de campagne",
      icon: "👑",
      current: hoursPlayed(profile),
      target: 48,
      remaining: Math.max(0, 48 - hoursPlayed(profile)),
      formatter: (value) => `${formatDecimal(value)} h`,
    },
  ];

  const pending = thresholds
    .filter((item) => item.current < item.target)
    .sort((left, right) => (left.remaining / left.target) - (right.remaining / right.target));

  return pending[0] ?? null;
}

export function profileMeter(score: number, size = 10): string {
  const filled = clamp(Math.round((score / 100) * size), 0, size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

export function profilePortraitUrl(uuid: string, size = 128): string {
  return `https://mc-heads.net/avatar/${uuid}/${size}`;
}
