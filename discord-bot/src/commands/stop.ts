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
import { messages } from "../messages.ts";
import { embed, getRconConfig, type RepliableI } from "./_shared.ts";

export const stopCommand = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Arrête proprement le serveur après un compte à rebours")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

export async function runStopFlow(i: RepliableI): Promise<void> {
  const { stop } = messages;
  const s = await getStatus();

  if (!s.online) {
    await i.editReply({ embeds: [embed.info(stop.alreadyStopped.title, stop.alreadyStopped.description)] });
    return;
  }

  const cfg = getRconConfig();
  if (!cfg) {
    await i.editReply({ embeds: [embed.error(stop.noRcon.title, stop.noRcon.description)] });
    return;
  }

  const playerNote = s.players.online > 0
    ? stop.confirm.playerNote(s.players.online)
    : stop.confirm.noPlayers;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("stop:cancel").setLabel(stop.confirm.cancelButton).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("stop:confirm").setLabel(stop.confirm.confirmButton).setStyle(ButtonStyle.Danger),
  );

  await i.editReply({
    embeds: [embed.warning(stop.confirm.title, playerNote)],
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
    await i.editReply({ embeds: [embed.info(stop.expired.title, stop.expired.description)], components: [] });
    return;
  }

  if (btn.customId === "stop:cancel") {
    await btn.update({ embeds: [embed.info(stop.cancelled.title, stop.cancelled.description)], components: [] });
    return;
  }

  const COUNTDOWN_SECONDS = 15;
  await btn.update({
    embeds: [embed.warning(stop.countdownTitle(COUNTDOWN_SECONDS), stop.countdownDesc(i.user.username))],
    components: [],
  });

  try {
    await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
      r.send(stop.rconMessage(COUNTDOWN_SECONDS, i.user.username)),
    );
  } catch {
    // Not fatal — server might not respond to the warning
  }

  await Bun.sleep(COUNTDOWN_SECONDS * 1000);

  try {
    // Fire-and-forget: the server stops before it can send a RCON response,
    // so we intentionally ignore the timeout rejection.
    await withRcon(cfg.host, cfg.port, cfg.password, async (r) => {
      try { await r.send("stop"); } catch { /* expected */ }
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed.error(stop.rconError.title, err instanceof Error ? err.message : undefined)],
    });
    return;
  }

  await i.editReply({ embeds: [embed.success(stop.success.title, stop.success.description)] });
}

export async function handleStop(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  await runStopFlow(i);
}
