import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Interaction,
} from "discord.js";
import { env } from "../env.ts";
import { getStatus } from "../lib/mc.ts";
import { withRcon } from "../lib/rcon.ts";

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

// ── RCON helper ───────────────────────────────────────────────────────────────

function getRconConfig(): { host: string; port: number; password: string } | null {
  if (!env.MC_RCON_PASSWORD) return null;
  return {
    host:     env.MC_RCON_HOST ?? env.MC_HOST,
    port:     Number(env.MC_RCON_PORT),
    password: env.MC_RCON_PASSWORD,
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

// ── /status ───────────────────────────────────────────────────────────────────

async function handleStatus(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  const s = await getStatus();

  if (!s.online) {
    await i.editReply({
      embeds: [embed.error("Serveur hors ligne", "Le serveur ne répond pas au ping.")],
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

  if (s.motd) {
    statusEmbed.setDescription(`*${s.motd}*`);
  }

  if (s.players.list.length > 0) {
    statusEmbed.addFields({
      name:  "Connectés",
      value: s.players.list.map((p) => `• ${p}`).join("\n"),
    });
  }

  await i.editReply({ embeds: [statusEmbed] });
}

// ── /start ────────────────────────────────────────────────────────────────────
//
// With ENABLE_AUTOPAUSE=TRUE on the MC service, the JVM is frozen (SIGSTOP)
// when no players are connected. Each TCP connection attempt to the MC port
// acts as a "knock" that wakes the process. minecraftstatuspinger opens a TCP
// connection on every call, so polling it is all we need to wake the server.

async function handleStart(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  // Fast path — already online
  const initial = await getStatus();
  if (initial.online) {
    const e = embed
      .success("Serveur déjà en ligne")
      .addFields(
        { name: "Joueurs", value: `${initial.players.online} / ${initial.players.max}`, inline: true },
      );
    if (initial.version) e.addFields({ name: "Version", value: initial.version, inline: true });
    await i.editReply({ embeds: [e] });
    return;
  }

  // Guard against concurrent /start calls in the same guild
  const key = i.guildId ?? "global";
  if (startInProgress.has(key)) {
    await i.editReply({
      embeds: [embed.warning("Démarrage déjà en cours", "Un démarrage est déjà en attente dans ce serveur.")],
    });
    return;
  }

  startInProgress.add(key);

  try {
    await i.editReply({
      embeds: [embed.info("Démarrage en cours", "En attente de la réponse du serveur (max 3 min).")],
    });

    await pollUntilOnline(i, 3 * 60_000);
  } finally {
    startInProgress.delete(key);
  }
}

// ── /restart ──────────────────────────────────────────────────────────────────
//
// Sends RCON `stop`, waits for the server to go offline, then polls until it
// comes back (Railway restarts the container automatically with policy ALWAYS).

async function handleRestart(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

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

  startInProgress.add(key);

  try {
    const COUNTDOWN_SECONDS = 10;

    const s = await getStatus();
    if (s.online) {
      // Warn players then stop
      try {
        await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
          r.send(`say [Discord] Redémarrage du serveur dans ${COUNTDOWN_SECONDS} secondes (${i.user.username})`),
        );
      } catch {
        // Not fatal
      }

      await i.editReply({
        embeds: [embed.warning(`Redémarrage dans ${COUNTDOWN_SECONDS}s`, `Initié par **${i.user.username}**.`)],
      });

      await Bun.sleep(COUNTDOWN_SECONDS * 1000);

      // Stop — server won't reply before shutting down, which is expected
      await withRcon(cfg.host, cfg.port, cfg.password, async (r) => {
        try { await r.send("stop"); } catch { /* expected */ }
      }).catch(() => { /* server may already be stopping */ });
    }

    await i.editReply({
      embeds: [embed.info("Redémarrage en cours", "Attente de l'extinction puis du retour du serveur (max 5 min).")],
    });

    // Wait for the server to go offline before polling for it to come back
    const OFFLINE_WAIT_MS  = 20_000;
    const OFFLINE_DEADLINE = Date.now() + 90_000;

    let isOffline = false;
    while (Date.now() < OFFLINE_DEADLINE) {
      await Bun.sleep(OFFLINE_WAIT_MS);
      const check = await getStatus();
      if (!check.online) { isOffline = true; break; }
    }

    if (!isOffline) {
      // The server might still be online (e.g. RCON stop failed silently)
      // but we try to bring it back anyway
    }

    // Now wait for it to come back online (Railway restart + JVM + mod loading)
    await pollUntilOnline(i, 5 * 60_000, true);
  } finally {
    startInProgress.delete(key);
  }
}

// ── Shared polling helper ─────────────────────────────────────────────────────

/**
 * Poll `getStatus()` every 8 seconds until the server responds or the timeout
 * is reached. Edits `i`'s deferred reply to reflect progress and the outcome.
 *
 * Each `getStatus()` call opens a TCP connection to the MC port, which also
 * acts as an autopause knock to wake the JVM if it was frozen.
 */
async function pollUntilOnline(
  i: ChatInputCommandInteraction,
  maxWaitMs: number,
  isRestart = false,
): Promise<void> {
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
              { name: "Version", value: s.version ?? "Inconnue",                         inline: true },
              { name: "Joueurs", value: `${s.players.online} / ${s.players.max}`,         inline: true },
              { name: verb,      value: `${elapsed}s`,                                    inline: true },
            );

      if (s.motd) readyEmbed.setDescription(`*${s.motd}*`);

      await i.editReply({ embeds: [readyEmbed] });
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

// ── /stop ─────────────────────────────────────────────────────────────────────

async function handleStop(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

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

  const COUNTDOWN_SECONDS = 15;

  // Warn players in game
  try {
    await withRcon(cfg.host, cfg.port, cfg.password, (r) =>
      r.send(`say [Discord] Arret du serveur dans ${COUNTDOWN_SECONDS} secondes (${i.user.username})`),
    );
  } catch {
    // Not fatal — server might not respond to the warning
  }

  await i.editReply({
    embeds: [
      embed.warning(
        `Arret dans ${COUNTDOWN_SECONDS}s`,
        `Les joueurs ont ete avertis. Initie par **${i.user.username}**.`,
      ),
    ],
  });

  await Bun.sleep(COUNTDOWN_SECONDS * 1000);

  try {
    // Fire-and-forget: the server stops before it can send a RCON response,
    // so we intentionally ignore the timeout rejection.
    await withRcon(cfg.host, cfg.port, cfg.password, async (r) => {
      try {
        await r.send("stop");
      } catch {
        // Expected — server shuts down before answering
      }
    });

    await i.editReply({
      embeds: [embed.success("Serveur arrêté", "La commande `stop` a été envoyée via RCON.")],
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
  }
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
  if (!interaction.isChatInputCommand()) return;

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

    const fallback = {
      embeds: [embed.error("Erreur interne", "Une erreur s'est produite. Consultez les logs Railway.")],
    };

    if (i.deferred || i.replied) {
      await i.editReply(fallback).catch(() => undefined);
    } else {
      await i.reply({ ...fallback, ephemeral: true }).catch(() => undefined);
    }
  }
}
