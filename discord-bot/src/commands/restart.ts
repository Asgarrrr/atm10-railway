import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getStatus } from "../lib/mc.ts";
import { withRcon } from "../lib/rcon.ts";
import { restartService } from "../lib/railway.ts";
import { messages } from "../messages.ts";
import { embed, getRconConfig, getRailwayConfig, pollUntilOnline, startInProgress, type RepliableI } from "./_shared.ts";

export const restartCommand = new SlashCommandBuilder()
  .setName("restart")
  .setDescription("Redémarre le serveur et prévient quand il est de nouveau prêt")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

// Sends RCON `stop`, waits for the server to go offline, then polls until it
// comes back (Railway restarts the container automatically with policy ALWAYS).
export async function runRestartFlow(i: RepliableI): Promise<void> {
  const { restart } = messages;
  const key = i.guildId ?? "global";

  if (startInProgress.has(key)) {
    await i.editReply({
      embeds: [embed.warning(restart.alreadyInProgress.title, restart.alreadyInProgress.description)],
    });
    return;
  }

  const cfg = getRconConfig();
  if (!cfg) {
    await i.editReply({ embeds: [embed.error(restart.noRcon.title, restart.noRcon.description)] });
    return;
  }

  const s = await getStatus();
  const playerNote = s.online && s.players.online > 0
    ? restart.confirm.playerNote(s.players.online)
    : s.online ? restart.confirm.noPlayers : restart.confirm.serverOffline;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("restart:cancel").setLabel(restart.confirm.cancelButton).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("restart:confirm").setLabel(restart.confirm.confirmButton).setStyle(ButtonStyle.Primary),
  );

  await i.editReply({
    embeds: [embed.warning(restart.confirm.title, playerNote)],
    components: [row],
  });

  const msg = await i.fetchReply();
  let btn: ButtonInteraction;
  try {
    btn = await msg.awaitMessageComponent({
      filter: (b) => b.user.id === i.user.id,
      time: 30_000,
    }) as ButtonInteraction;
  } catch {
    await i.editReply({ embeds: [embed.info(restart.expired.title, restart.expired.description)], components: [] });
    return;
  }

  if (btn.customId === "restart:cancel") {
    await btn.update({ embeds: [embed.info(restart.cancelled.title, restart.cancelled.description)], components: [] });
    return;
  }

  const COUNTDOWN_SECONDS = 10;
  await btn.update({
    embeds: [embed.warning(restart.countdownTitle(COUNTDOWN_SECONDS), restart.countdownDesc(i.user.username))],
    components: [],
  });

  startInProgress.add(key);
  try {
    if (s.online) {
      try {
        await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
          r.send(restart.rconMessage(COUNTDOWN_SECONDS, i.user.username)),
        );
      } catch {
        // Not fatal
      }

      await Bun.sleep(COUNTDOWN_SECONDS * 1000);

      // Stop — server won't reply before shutting down, which is expected
      await withRcon(cfg.host, cfg.port, cfg.password, async (r) => {
        try { await r.send("stop"); } catch { /* expected */ }
      }).catch(() => { /* server may already be stopping */ });
    }

    // Trigger a Railway redeploy so the container comes back up.
    // With ON_FAILURE restart policy, a clean exit (code 0) does not trigger
    // an automatic restart, so we must explicitly call the API.
    const railwayCfg = getRailwayConfig();
    if (railwayCfg) {
      await i.editReply({ embeds: [embed.info(restart.triggering.title, restart.triggering.description)] });
      try {
        await restartService(railwayCfg);
      } catch (err) {
        console.warn("Railway restartService failed during /restart:", err);
        // Non-fatal — continue and poll; the service may restart via other means.
      }
    }

    const waitMsg = railwayCfg ? restart.waitingWithRailway : restart.waitingWithoutRailway;
    await i.editReply({ embeds: [embed.info(waitMsg.title, waitMsg.description)] });

    // Wait for the server to go offline before polling for it to come back
    const OFFLINE_WAIT_MS  = 20_000;
    const OFFLINE_DEADLINE = Date.now() + 90_000;

    while (Date.now() < OFFLINE_DEADLINE) {
      await Bun.sleep(OFFLINE_WAIT_MS);
      const check = await getStatus();
      if (!check.online) break;
    }

    await pollUntilOnline(i, 5 * 60_000, true);
  } finally {
    startInProgress.delete(key);
  }
}

export async function handleRestart(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  await runRestartFlow(i);
}
