import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getStatus } from "../lib/mc.ts";
import { restartService } from "../lib/railway.ts";
import { messages } from "../messages.ts";
import { embed, getRailwayConfig, pollUntilOnline, startInProgress, type RepliableI } from "./_shared.ts";

export const startCommand = new SlashCommandBuilder()
  .setName("start")
  .setDescription("Réveille le serveur et prévient dans ce salon quand il est prêt")
  .toJSON();

// With ENABLE_AUTOPAUSE=TRUE on the MC service, the JVM is frozen (SIGSTOP)
// when no players are connected. Each TCP connection attempt to the MC port
// acts as a "knock" that wakes the process. minecraftstatuspinger opens a TCP
// connection on every call, so polling it is all we need to wake the server.
export async function runStartFlow(i: RepliableI): Promise<void> {
  const { start } = messages;
  const initial = await getStatus();

  if (initial.online) {
    const e = embed
      .success(start.alreadyOnline.title)
      .addFields({ name: messages.poll.fields.players, value: `${initial.players.online} / ${initial.players.max}`, inline: true });
    if (initial.version) e.addFields({ name: messages.poll.fields.version, value: initial.version, inline: true });
    await i.editReply({ embeds: [e] });
    return;
  }

  const key = i.guildId ?? "global";
  if (startInProgress.has(key)) {
    await i.editReply({
      embeds: [embed.warning(start.alreadyInProgress.title, start.alreadyInProgress.description)],
    });
    return;
  }

  startInProgress.add(key);
  try {
    const railwayCfg = getRailwayConfig();
    if (railwayCfg) {
      await i.editReply({ embeds: [embed.info(start.triggering.title, start.triggering.description)] });
      try {
        await restartService(railwayCfg);
      } catch (err) {
        // Non-fatal — log and continue polling; the service may already be starting.
        console.warn("Railway restartService failed, polling anyway:", err);
      }
    }
    await i.editReply({ embeds: [embed.info(start.waiting.title, start.waiting.description)] });
    await pollUntilOnline(i, 3 * 60_000);
  } finally {
    startInProgress.delete(key);
  }
}

export async function handleStart(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  await runStartFlow(i);
}
