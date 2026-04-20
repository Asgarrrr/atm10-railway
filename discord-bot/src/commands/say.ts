import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getStatus } from "../lib/mc.ts";
import { withRcon } from "../lib/rcon.ts";
import { messages } from "../messages.ts";
import { getRconConfig } from "./_shared.ts";

export const sayCommand = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Envoie un message visible par tous les joueurs en jeu")
  .addStringOption((o) =>
    o
      .setName("message")
      .setDescription("Texte à diffuser en jeu")
      .setRequired(true)
      .setMaxLength(200),
  )
  .toJSON();

export async function handleSay(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const { say } = messages;
  const message = i.options.getString("message", true);
  const cfg = getRconConfig();

  if (!cfg) {
    await i.editReply(say.noRcon);
    return;
  }

  const s = await getStatus();
  if (!s.online) {
    await i.editReply(say.serverOffline);
    return;
  }

  try {
    await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
      r.send(say.rconCommand(i.user.username, message)),
    );
    await i.editReply(say.success(message));
  } catch (err) {
    await i.editReply(say.rconError(err instanceof Error ? err.message : "Erreur inconnue."));
  }
}
