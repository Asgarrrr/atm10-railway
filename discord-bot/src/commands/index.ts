import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Interaction,
} from "discord.js";
import { env } from "../env.ts";
import { getStatus } from "../lib/mc.ts";
import { withRcon } from "../lib/rcon.ts";
import { restartService, stopService } from "../lib/railway.ts";

type RepliableI = ChatInputCommandInteraction | ButtonInteraction;

// ── Embed factories ───────────────────────────────────────────────────────────

const embed = {
  success: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0x2ecc71).setTitle(title).setDescription(desc ?? null),

  error: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0xe74c3c).setTitle(title).setDescription(desc ?? null),

  info: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0x3498db).setTitle(title).setDescription(desc ?? null),

  warning: (title: string, desc?: string) =>
    new EmbedBuilder().setColor(0xe67e22).setTitle(title).setDescription(desc ?? null),
};

// ── Config helpers ─────────────────────────────────────────────────────────────

function getRconConfig(): { host: string; port: number; password: string } | null {
  if (!env.MC_RCON_PASSWORD) return null;
  return {
    host:     env.MC_RCON_HOST ?? env.MC_HOST,
    port:     Number(env.MC_RCON_PORT),
    password: env.MC_RCON_PASSWORD,
  };
}

function getRailwayConfig(): { token: string; serviceId: string; environmentId: string } | null {
  if (!env.RAILWAY_API_TOKEN || !env.RAILWAY_MC_SERVICE_ID || !env.RAILWAY_ENVIRONMENT_ID) return null;
  return {
    token:         env.RAILWAY_API_TOKEN,
    serviceId:     env.RAILWAY_MC_SERVICE_ID,
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
  };
}

// Tracks guilds where a /start or /restart poll is already running,
// so a second invocation gets a friendly message instead of a duplicate loop.
const startInProgress = new Set<string>();

// ── Command builders (registered at startup) ──────────────────────────────────

export const COMMANDS = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche l'état actuel du serveur Minecraft"),

  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Réveille le serveur et prévient dans ce salon quand il est prêt"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête proprement le serveur après un compte à rebours")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Redémarre le serveur et prévient quand il est de nouveau prêt")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("players")
    .setDescription("Liste les joueurs actuellement connectés"),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Envoie un message visible par tous les joueurs en jeu")
    .addStringOption((o) =>
      o
        .setName("message")
        .setDescription("Texte à diffuser en jeu")
        .setRequired(true)
        .setMaxLength(200),
    ),

  new SlashCommandBuilder()
    .setName("cmd")
    .setDescription("Exécute une commande RCON arbitraire (admin uniquement)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("commande")
        .setDescription("Commande à exécuter (sans le /)")
        .setRequired(true)
        .setMaxLength(500),
    ),
].map((c) => c.toJSON());

// ── Shared polling helper ─────────────────────────────────────────────────────

/**
 * Poll `getStatus()` every 8 seconds until the server responds or the timeout
 * is reached. Edits `i`'s deferred reply to reflect progress and the outcome.
 *
 * Each `getStatus()` call opens a TCP connection to the MC port, which also
 * acts as an autopause knock to wake the JVM if it was frozen.
 */
async function pollUntilOnline(i: RepliableI, maxWaitMs: number, isRestart = false): Promise<void> {
  const POLL_INTERVAL = 8_000;
  const startedAt     = Date.now();
  const verb          = isRestart ? "Redémarrage" : "Démarrage";

  while (Date.now() - startedAt < maxWaitMs) {
    await Bun.sleep(POLL_INTERVAL);

    const s = await getStatus();

    if (s.online) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      const readyEmbed = embed
        .success("Serveur disponible")
        .addFields(
          { name: "Version", value: s.version ?? "Inconnue",                        inline: true },
          { name: "Joueurs", value: `${s.players.online} / ${s.players.max}`,        inline: true },
          { name: verb,      value: `${elapsed}s`,                                   inline: true },
        );

      if (s.motd) readyEmbed.setDescription(`*${s.motd}*`);

      await i.editReply({ embeds: [readyEmbed], components: [] });
      return;
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    await i.editReply({
      embeds: [embed.info(`${verb} en cours`, `En attente du serveur... (${elapsed}s)`)],
    });
  }

  await i.editReply({
    embeds: [
      embed.error(
        "Timeout",
        `Le serveur n'a pas répondu en ${Math.round(maxWaitMs / 60_000)} minutes. Vérifiez les logs dans le dashboard Railway.`,
      ),
    ],
  });
}

// ── /status ───────────────────────────────────────────────────────────────────

async function handleStatus(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  const s = await getStatus();

  if (!s.online) {
    const canStart = !!(getRailwayConfig() || getRconConfig());
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("panel:start")
        .setLabel("Démarrer")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canStart),
    );
    await i.editReply({
      embeds: [embed.error("Serveur hors ligne", "Le serveur ne répond pas au ping.")],
      components: [row],
    });
    return;
  }

  const statusEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Serveur en ligne")
    .addFields(
      { name: "Version",  value: s.version ?? "Inconnue",                        inline: true },
      { name: "Joueurs",  value: `${s.players.online} / ${s.players.max}`,        inline: true },
      { name: "Latence",  value: s.latency !== null ? `${s.latency} ms` : "N/A", inline: true },
    );

  if (s.motd) statusEmbed.setDescription(`*${s.motd}*`);
  if (s.players.list.length > 0) {
    statusEmbed.addFields({
      name:  "Connectés",
      value: s.players.list.map((p) => `• ${p}`).join("\n"),
    });
  }

  const hasRcon = !!getRconConfig();
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("panel:restart")
      .setLabel("Redémarrer")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasRcon),
    new ButtonBuilder()
      .setCustomId("panel:stop")
      .setLabel("Arrêter")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasRcon),
  );

  await i.editReply({ embeds: [statusEmbed], components: [row] });
}

// ── /start ────────────────────────────────────────────────────────────────────
//
// With ENABLE_AUTOPAUSE=TRUE on the MC service, the JVM is frozen (SIGSTOP)
// when no players are connected. Each TCP connection attempt to the MC port
// acts as a "knock" that wakes the process. minecraftstatuspinger opens a TCP
// connection on every call, so polling it is all we need to wake the server.

async function runStartFlow(i: RepliableI): Promise<void> {
  const initial = await getStatus();
  if (initial.online) {
    const e = embed
      .success("Serveur déjà en ligne")
      .addFields({ name: "Joueurs", value: `${initial.players.online} / ${initial.players.max}`, inline: true });
    if (initial.version) e.addFields({ name: "Version", value: initial.version, inline: true });
    await i.editReply({ embeds: [e] });
    return;
  }

  const key = i.guildId ?? "global";
  if (startInProgress.has(key)) {
    await i.editReply({
      embeds: [embed.warning("Démarrage déjà en cours", "Un démarrage est déjà en attente dans ce serveur.")],
    });
    return;
  }

  startInProgress.add(key);
  try {
    const railwayCfg = getRailwayConfig();
    if (railwayCfg) {
      await i.editReply({ embeds: [embed.info("Démarrage en cours", "Déclenchement du redéploiement Railway...")] });
      try {
        await restartService(railwayCfg);
      } catch (err) {
        // Non-fatal — log and continue polling; the service may already be starting.
        console.warn("Railway restartService failed, polling anyway:", err);
      }
    }
    await i.editReply({ embeds: [embed.info("Démarrage en cours", "En attente de la réponse du serveur (max 3 min).")] });
    await pollUntilOnline(i, 3 * 60_000);
  } finally {
    startInProgress.delete(key);
  }
}

async function handleStart(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  await runStartFlow(i);
}

// ── /stop ─────────────────────────────────────────────────────────────────────

async function runStopFlow(i: RepliableI): Promise<void> {
  const s = await getStatus();
  if (!s.online) {
    await i.editReply({ embeds: [embed.info("Serveur déjà arrêté", "Le serveur ne répond pas.")] });
    return;
  }

  const cfg = getRconConfig();
  if (!cfg) {
    await i.editReply({
      embeds: [
        embed.error(
          "RCON non configuré",
          "Ajoutez `MC_RCON_PASSWORD` dans les variables Railway du service Discord bot.",
        ),
      ],
    });
    return;
  }

  const playerNote = s.players.online > 0
    ? `**${s.players.online}** joueur(s) en ligne seront avertis avant l'arrêt.`
    : "Aucun joueur connecté.";

  const confirmBtn = new ButtonBuilder()
    .setCustomId("stop:confirm")
    .setLabel("Confirmer l'arrêt")
    .setStyle(ButtonStyle.Danger);
  const cancelBtn = new ButtonBuilder()
    .setCustomId("stop:cancel")
    .setLabel("Annuler")
    .setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn, confirmBtn);

  await i.editReply({
    embeds: [embed.warning("Arrêter le serveur ?", playerNote)],
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
    await i.editReply({ embeds: [embed.info("Annulé", "Confirmation expirée.")], components: [] });
    return;
  }

  if (btn.customId === "stop:cancel") {
    await btn.update({ embeds: [embed.info("Annulé", "Arrêt annulé.")], components: [] });
    return;
  }

  const COUNTDOWN_SECONDS = 15;
  await btn.update({
    embeds: [embed.warning(`Arrêt dans ${COUNTDOWN_SECONDS}s`, `Les joueurs vont être avertis. Initié par **${i.user.username}**.`)],
    components: [],
  });

  try {
    await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
      r.send(`say [Discord] Arret du serveur dans ${COUNTDOWN_SECONDS} secondes (${i.user.username})`),
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
      embeds: [
        embed.error(
          "Erreur RCON",
          err instanceof Error ? err.message : "Impossible de joindre le serveur via RCON.",
        ),
      ],
    });
    return;
  }

  // Optionally tell Railway to set replicas = 0 so the service stays stopped.
  // With ON_FAILURE policy, a clean exit (code 0) won't auto-restart, but
  // calling the API makes the stopped state explicit in the Railway dashboard.
  const railwayCfg = getRailwayConfig();
  if (railwayCfg) {
    try {
      await stopService(railwayCfg);
      await i.editReply({
        embeds: [
          embed.success(
            "Serveur arrêté",
            "La commande `stop` a été envoyée via RCON et le service Railway a été mis à l'arrêt (replicas = 0).",
          ),
        ],
      });
    } catch (err) {
      console.warn("Railway stopService failed:", err);
      await i.editReply({
        embeds: [
          embed.warning(
            "Serveur arrêté (RCON uniquement)",
            "RCON `stop` envoyé. L'arrêt Railway a échoué — le service pourrait redémarrer selon la politique configurée.",
          ),
        ],
      });
    }
  } else {
    await i.editReply({
      embeds: [
        embed.success(
          "Serveur arrêté",
          "La commande `stop` a été envoyée via RCON. " +
          "Configurez `RAILWAY_API_TOKEN` pour un arrêt Railway complet (replicas = 0).",
        ),
      ],
    });
  }
}

async function handleStop(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  await runStopFlow(i);
}

// ── /restart ──────────────────────────────────────────────────────────────────
//
// Sends RCON `stop`, waits for the server to go offline, then polls until it
// comes back (Railway restarts the container automatically with policy ALWAYS).

async function runRestartFlow(i: RepliableI): Promise<void> {
  const key = i.guildId ?? "global";
  if (startInProgress.has(key)) {
    await i.editReply({
      embeds: [embed.warning("Opération déjà en cours", "Un démarrage ou redémarrage est déjà en attente.")],
    });
    return;
  }

  const cfg = getRconConfig();
  if (!cfg) {
    await i.editReply({
      embeds: [
        embed.error(
          "RCON non configuré",
          "Ajoutez `MC_RCON_PASSWORD` dans les variables Railway du service Discord bot.",
        ),
      ],
    });
    return;
  }

  const s = await getStatus();
  const playerNote = s.online && s.players.online > 0
    ? `**${s.players.online}** joueur(s) en ligne seront avertis.`
    : s.online ? "Serveur en ligne, aucun joueur connecté." : "Le serveur n'est pas en ligne.";

  const confirmBtn = new ButtonBuilder()
    .setCustomId("restart:confirm")
    .setLabel("Confirmer le redémarrage")
    .setStyle(ButtonStyle.Primary);
  const cancelBtn = new ButtonBuilder()
    .setCustomId("restart:cancel")
    .setLabel("Annuler")
    .setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn, confirmBtn);

  await i.editReply({
    embeds: [embed.warning("Redémarrer le serveur ?", playerNote)],
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
    await i.editReply({ embeds: [embed.info("Annulé", "Confirmation expirée.")], components: [] });
    return;
  }

  if (btn.customId === "restart:cancel") {
    await btn.update({ embeds: [embed.info("Annulé", "Redémarrage annulé.")], components: [] });
    return;
  }

  const COUNTDOWN_SECONDS = 10;
  await btn.update({
    embeds: [embed.warning(`Redémarrage dans ${COUNTDOWN_SECONDS}s`, `Initié par **${i.user.username}**.`)],
    components: [],
  });

  startInProgress.add(key);
  try {
    if (s.online) {
      try {
        await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
          r.send(`say [Discord] Redémarrage du serveur dans ${COUNTDOWN_SECONDS} secondes (${i.user.username})`),
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
      await i.editReply({ embeds: [embed.info("Redémarrage en cours", "Déclenchement du redéploiement Railway...")] });
      try {
        await restartService(railwayCfg);
      } catch (err) {
        console.warn("Railway restartService failed during /restart:", err);
        // Non-fatal — continue and poll; the service may restart via other means.
      }
    }

    await i.editReply({
      embeds: [
        embed.info(
          "Redémarrage en cours",
          railwayCfg
            ? "Redéploiement déclenché. Attente du retour du serveur (max 5 min)."
            : "Attente de l'extinction puis du retour du serveur (max 5 min).\n" +
              "Note : sans `RAILWAY_API_TOKEN`, le redémarrage automatique dépend de la politique Railway.",
        ),
      ],
    });

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

async function handleRestart(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();
  await runRestartFlow(i);
}

// ── /players ──────────────────────────────────────────────────────────────────

async function handlePlayers(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const s = await getStatus();
  if (!s.online) {
    await i.editReply({ embeds: [embed.error("Serveur hors ligne")] });
    return;
  }

  if (s.players.online === 0) {
    await i.editReply({ embeds: [embed.info("Aucun joueur connecté", "Le serveur tourne mais est vide.")] });
    return;
  }

  // The status ping caps the sample list at 12 players by default.
  // RCON `list` is accurate for larger servers.
  let playerList = s.players.list;

  const cfg = getRconConfig();
  if (cfg) {
    try {
      const raw = await withRcon(cfg.host, cfg.port, cfg.password, (r) => r.send("list"));
      // "There are X of a max of Y players online: Alice, Bob, Charlie"
      const match = raw.match(/players\s+online:?\s*(.+)$/i);
      if (match?.[1]) {
        const parsed = match[1]
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
        if (parsed.length > 0) playerList = parsed;
      }
    } catch {
      // Fall back to the ping list
    }
  }

  const playersEmbed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${s.players.online} / ${s.players.max} joueur(s) en ligne`)
    .setDescription(
      playerList.length > 0
        ? playerList.map((p) => `\`${p}\``).join("\n")
        : "Liste non disponible — le ping ne renvoie pas les noms.",
    );

  await i.editReply({ embeds: [playersEmbed] });
}

// ── /say ──────────────────────────────────────────────────────────────────────

async function handleSay(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const message = i.options.getString("message", true);
  const cfg = getRconConfig();

  if (!cfg) {
    await i.editReply("RCON non configuré (`MC_RCON_PASSWORD` manquant).");
    return;
  }

  const s = await getStatus();
  if (!s.online) {
    await i.editReply("Le serveur est hors ligne.");
    return;
  }

  try {
    await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
      r.send(`say [Discord] ${i.user.username}: ${message}`),
    );
    await i.editReply(`Message envoyé : **${message}**`);
  } catch (err) {
    await i.editReply(
      `Erreur RCON : ${err instanceof Error ? err.message : "Erreur inconnue."}`,
    );
  }
}

// ── /cmd ──────────────────────────────────────────────────────────────────────

async function handleCmd(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const command = i.options.getString("commande", true);
  const cfg = getRconConfig();

  if (!cfg) {
    await i.editReply("RCON non configuré (`MC_RCON_PASSWORD` manquant).");
    return;
  }

  try {
    const result = await withRcon(cfg.host, cfg.port, cfg.password, (r) => r.send(command));
    const output = result.trim() || "(pas de réponse du serveur)";

    await i.editReply({
      embeds: [
        embed
          .info(`> ${command}`)
          .setDescription(`\`\`\`\n${output.slice(0, 1900)}\n\`\`\``),
      ],
    });
  } catch (err) {
    await i.editReply(
      `Erreur RCON : ${err instanceof Error ? err.message : "Erreur inconnue."}`,
    );
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function handleCommand(interaction: Interaction): Promise<void> {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const i = interaction;
    try {
      switch (i.commandName) {
        case "status":  return await handleStatus(i);
        case "start":   return await handleStart(i);
        case "stop":    return await handleStop(i);
        case "restart": return await handleRestart(i);
        case "players": return await handlePlayers(i);
        case "say":     return await handleSay(i);
        case "cmd":     return await handleCmd(i);
      }
    } catch (error) {
      console.error(`Unhandled error in /${i.commandName}:`, error);
      const fallback = { embeds: [embed.error("Erreur interne", "Une erreur s'est produite. Consultez les logs Railway.")] };
      if (i.deferred || i.replied) {
        await i.editReply(fallback).catch(() => undefined);
      } else {
        await i.reply({ ...fallback, ephemeral: true }).catch(() => undefined);
      }
    }
    return;
  }

  // Panel buttons from /status
  if (interaction.isButton()) {
    const btn = interaction;
    try {
      switch (btn.customId) {
        case "panel:start": {
          await btn.deferReply();
          await runStartFlow(btn);
          break;
        }
        case "panel:stop": {
          if (!btn.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await btn.reply({
              embeds: [embed.error("Permissions insuffisantes", "Cette action requiert la permission `Gérer le serveur`.")],
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
            await btn.reply({
              embeds: [embed.error("Permissions insuffisantes", "Cette action requiert la permission `Gérer le serveur`.")],
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
      const fallback = { embeds: [embed.error("Erreur interne", "Une erreur s'est produite. Consultez les logs Railway.")] };
      if (btn.deferred || btn.replied) {
        await btn.editReply(fallback).catch(() => undefined);
      } else {
        await btn.reply({ ...fallback, ephemeral: true }).catch(() => undefined);
      }
    }
  }
}
