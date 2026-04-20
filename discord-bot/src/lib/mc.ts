import mc from "minecraftstatuspinger";
import { env } from "../env.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type McStatusOnline = {
  online: true;
  version: string | null;
  motd: string | null;
  players: {
    online: number;
    max: number;
    list: string[];
  };
  latency: number | null;
};

export type McStatusOffline = {
  online: false;
};

export type McStatus = McStatusOnline | McStatusOffline;

// ── Status ping ───────────────────────────────────────────────────────────────

export async function getStatus(): Promise<McStatus> {
  try {
    const res = await mc.lookup({
      host:              env.MC_HOST,
      port:              Number(env.MC_PORT),
      timeout:           3000,
      ping:              true,
      SRVLookup:         false,
      JSONParse:         true,
      throwOnParseError: false,
    });

    // minecraftstatuspinger may return the parsed object in `status` or the
    // raw JSON string in `statusRaw` — normalise both paths.
    const raw: Record<string, unknown> | null =
      (res.status as Record<string, unknown> | null) ??
      (res.statusRaw ? tryParseJson(res.statusRaw as string) : null);

    if (!raw) return { online: false };

    const version =
      typeof raw["version"] === "string"
        ? raw["version"]
        : ((raw["version"] as { name?: string } | undefined)?.name ?? null);

    const playersBlock = raw["players"] as
      | { online?: number; max?: number; sample?: unknown[] }
      | undefined;

    const playersOnline = playersBlock?.online ?? 0;
    const playersMax    = playersBlock?.max    ?? 0;

    const list: string[] = (playersBlock?.sample ?? [])
      .map((p) =>
        typeof p === "string"
          ? p
          : ((p as { name?: string } | null)?.name ?? null),
      )
      .filter((n): n is string => typeof n === "string" && n.length > 0);

    return {
      online:  true,
      version,
      motd:    normalizeMotd(raw["description"] ?? raw["motd"]),
      players: { online: playersOnline, max: playersMax, list },
      latency: typeof res.latency === "number" ? res.latency : null,
    };
  } catch {
    return { online: false };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract a plain-text MOTD from the many possible shapes the MC protocol
 * returns it in (string, legacy §-coded string, Chat component object, or
 * the minecraftstatuspinger normalised shape with `clean` / `raw` keys).
 */
function normalizeMotd(motd: unknown): string | null {
  if (!motd) return null;

  if (typeof motd === "string") {
    // Strip legacy Minecraft colour/formatting codes (§X)
    return motd.replace(/§./g, "").trim() || null;
  }

  if (typeof motd === "object" && motd !== null) {
    const o = motd as Record<string, unknown>;

    // minecraftstatuspinger wraps the MOTD in { clean, raw, html }
    for (const key of ["clean", "raw"] as const) {
      const v = o[key];
      if (Array.isArray(v)) {
        const joined = (v as unknown[])
          .map((x) => (typeof x === "string" ? x : ""))
          .join(" ")
          .trim();
        if (joined) return joined;
      }
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }

    // Vanilla Chat component: { text: "...", extra: [...] }
    if (typeof o["text"] === "string" && o["text"].trim()) {
      return o["text"].trim();
    }
  }

  return null;
}
