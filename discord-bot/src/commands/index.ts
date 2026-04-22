import { PermissionFlagsBits, type Interaction } from "discord.js";
import { env } from "../env.ts";
import { messages } from "../messages.ts";
import { embed } from "./_shared.ts";
import { statusCommand, handleStatus } from "./status.ts";
import { startCommand, handleStart, runStartFlow } from "./start.ts";
import { stopCommand, handleStop, runStopFlow } from "./stop.ts";
import { restartCommand, handleRestart, runRestartFlow } from "./restart.ts";
import { playersCommand, handlePlayers } from "./players.ts";
import { profileCommand, profileContextCommand, handleProfile, handleProfileButton, handleProfileContextMenu } from "./profile.ts";
import { sayCommand, handleSay } from "./say.ts";
import { cmdCommand, handleCmd } from "./cmd.ts";
import { backupCommand, handleBackup } from "./backup.ts";
import { opCommand, handleOp } from "./op.ts";
import { restoreCommand, handleRestore } from "./restore.ts";

export const COMMANDS = [
  statusCommand,
  startCommand,
  stopCommand,
  restartCommand,
  playersCommand,
  profileCommand,
  profileContextCommand,
  sayCommand,
  cmdCommand,
  backupCommand,
  opCommand,
  restoreCommand,
];

export async function handleCommand(interaction: Interaction): Promise<void> {
  // ── Channel guard ───────────────────────────────────────────────────────────
  if (env.DISCORD_CHANNEL_ID && interaction.channelId !== env.DISCORD_CHANNEL_ID) {
    const { wrongChannel } = messages.common;
    const reply = {
      embeds: [embed.error(wrongChannel.title, wrongChannel.description(env.DISCORD_CHANNEL_ID))],
      ephemeral: true,
    };
    if (interaction.isChatInputCommand()) await interaction.reply(reply).catch(() => undefined);
    else if (interaction.isButton())      await interaction.reply(reply).catch(() => undefined);
    return;
  }

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const i = interaction;
    try {
      switch (i.commandName) {
        case "status":  return await handleStatus(i);
        case "start":   return await handleStart(i);
        case "stop":    return await handleStop(i);
        case "restart": return await handleRestart(i);
        case "players": return await handlePlayers(i);
        case "profile": return await handleProfile(i);
        case "say":     return await handleSay(i);
        case "cmd":     return await handleCmd(i);
        case "backup":  return await handleBackup(i);
        case "op":      return await handleOp(i);
        case "restore": return await handleRestore(i);
      }
    } catch (error) {
      console.error(`Unhandled error in /${i.commandName}:`, error);
      const { internalError } = messages.common;
      const fallback = { embeds: [embed.error(internalError.title, internalError.description)] };
      if (i.deferred || i.replied) await i.editReply(fallback).catch(() => undefined);
      else await i.reply({ ...fallback, ephemeral: true }).catch(() => undefined);
    }
    return;
  }

  if (interaction.isUserContextMenuCommand()) {
    const i = interaction;
    try {
      switch (i.commandName) {
        case "Minecraft Profile": return await handleProfileContextMenu(i);
      }
    } catch (error) {
      console.error(`Unhandled error in context menu ${i.commandName}:`, error);
      const { internalError } = messages.common;
      const fallback = { embeds: [embed.error(internalError.title, internalError.description)] };
      if (i.deferred || i.replied) await i.editReply(fallback).catch(() => undefined);
      else await i.reply({ ...fallback, ephemeral: true }).catch(() => undefined);
    }
    return;
  }

  // ── Panel buttons from /status ──────────────────────────────────────────────
  if (interaction.isButton()) {
    const btn = interaction;
    try {
      if (btn.customId.startsWith("profile:")) {
        await handleProfileButton(btn);
        return;
      }

      switch (btn.customId) {
        case "panel:start": {
          await btn.deferReply();
          await runStartFlow(btn);
          break;
        }
        case "panel:stop": {
          if (!btn.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            const { insufficientPerms } = messages.common;
            await btn.reply({
              embeds: [embed.error(insufficientPerms.title, insufficientPerms.description)],
              ephemeral: true,
            });
            return;
          }
          await btn.deferReply();
          await runStopFlow(btn);
          break;
        }
        case "panel:restart": {
          if (!btn.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            const { insufficientPerms } = messages.common;
            await btn.reply({
              embeds: [embed.error(insufficientPerms.title, insufficientPerms.description)],
              ephemeral: true,
            });
            return;
          }
          await btn.deferReply();
          await runRestartFlow(btn);
          break;
        }
      }
    } catch (error) {
      console.error(`Unhandled error in button ${btn.customId}:`, error);
      const { internalError } = messages.common;
      const fallback = { embeds: [embed.error(internalError.title, internalError.description)] };
      if (btn.deferred || btn.replied) await btn.editReply(fallback).catch(() => undefined);
      else await btn.reply({ ...fallback, ephemeral: true }).catch(() => undefined);
    }
  }
}
