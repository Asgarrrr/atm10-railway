import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { env } from "../env.ts";
import { getStatus } from "../lib/mc.ts";
import { messages } from "../messages.ts";

export type RepliableI = ChatInputCommandInteraction | ButtonInteraction;

export const embed = {
  success: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0x2ecc71).setTitle(title).setDescription(desc ?? null),
  error: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0xe74c3c).setTitle(title).setDescription(desc ?? null),
  info: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0x3498db).setTitle(title).setDescription(desc ?? null),
  warning: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0xe67e22).setTitle(title).setDescription(desc ?? null),
};

export function getRconConfig(): { host: string; port: number; password: string } | null {
  if (!env.MC_RCON_PASSWORD) return null;
  return {
    host:     env.MC_RCON_HOST ?? env.MC_HOST,
    port:     Number(env.MC_RCON_PORT),
    password: env.MC_RCON_PASSWORD,
  };
}

export function getRailwayConfig(): { token: string; serviceId: string; environmentId: string } | null {
  if (!env.RAILWAY_API_TOKEN || !env.RAILWAY_MC_SERVICE_ID || !env.RAILWAY_ENVIRONMENT_ID) return null;
  return {
    token:         env.RAILWAY_API_TOKEN,
    serviceId:     env.RAILWAY_MC_SERVICE_ID,
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
  };
}

// Tracks guilds where a /start or /restart poll is already running,
// so a second invocation gets a friendly message instead of a duplicate loop.
export const startInProgress = new Set<string>();

export async function pollUntilOnline(i: RepliableI, maxWaitMs: number, isRestart = false): Promise<void> {
  const POLL_INTERVAL = 8_000;
  const startedAt    = Date.now();
  const { poll }     = messages;
  const verb         = isRestart ? poll.fields.restart : poll.fields.start;

  while (Date.now() - startedAt < maxWaitMs) {
    await Bun.sleep(POLL_INTERVAL);

    const s = await getStatus();

    if (s.online) {
      const elapsed    = Math.round((Date.now() - startedAt) / 1000);
      const readyEmbed = embed
        .success(poll.ready.title)
        .addFields(
          { name: poll.fields.version, value: s.version ?? messages.common.unknownVersion, inline: true },
          { name: poll.fields.players, value: `${s.players.online} / ${s.players.max}`,   inline: true },
          { name: verb,                value: `${elapsed}s`,                               inline: true },
        );
      if (s.motd) readyEmbed.setDescription(`*${s.motd}*`);
      await i.editReply({ embeds: [readyEmbed], components: [] });
      return;
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    await i.editReply({
      embeds: [embed.info(poll.inProgressTitle(verb), poll.inProgress(verb, elapsed))],
    });
  }

  await i.editReply({
    embeds: [embed.error("Timeout", poll.timeout(Math.round(maxWaitMs / 60_000)))],
  });
}
