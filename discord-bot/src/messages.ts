// Customize this file freely — it is gitignored and won't be pushed to GitHub.
// See messages.example.ts for the full list of keys.

export const messages = {
  // ── /status ────────────────────────────────────────────────────────────────
  status: {
    offline: {
      title: "Serveur hors ligne",
      description: "Le serveur est actuellement éteint.",
    },
    online: { title: "Serveur en ligne" },
    buttons: {
      start: "Démarrer",
      restart: "Redémarrer",
      stop: "Arrêter",
    },
    fields: {
      version: "Version",
      players: "Joueurs",
      latency: "Latence",
      connected: "Connectés",
    },
  },

  // ── /start ─────────────────────────────────────────────────────────────────
  start: {
    alreadyOnline: { title: "Le serveur est déjà en ligne" },
    alreadyInProgress: {
      title: "Démarrage déjà en cours",
      description: "Le serveur est en train de démarrer, patiente un instant.",
    },
    triggering: {
      title: "Démarrage en cours",
      description: "Le serveur se réveille...",
    },
    waiting: {
      title: "Démarrage en cours",
      description: "Le serveur démarre, ça peut prendre quelques minutes. Tu seras notifié dès qu'il est prêt.",
    },
  },

  // ── /stop ──────────────────────────────────────────────────────────────────
  stop: {
    alreadyStopped: {
      title: "Serveur déjà arrêté",
      description: "Le serveur est déjà éteint.",
    },
    noRcon: {
      title: "Arrêt impossible",
      description: "La connexion au serveur n'est pas configurée (`MC_RCON_PASSWORD` manquant).",
    },
    confirm: {
      title: "Arrêter le serveur ?",
      playerNote: (count: number) => `**${count}** joueur(s) sont en ligne et seront prévenus avant l'arrêt.`,
      noPlayers: "Aucun joueur connecté en ce moment.",
      confirmButton: "Confirmer l'arrêt",
      cancelButton: "Annuler",
    },
    cancelled: { title: "Annulé", description: "L'arrêt du serveur a été annulé." },
    expired: { title: "Annulé", description: "Temps de confirmation écoulé." },
    countdownTitle: (seconds: number) => `Arrêt dans ${seconds}s`,
    countdownDesc: (user: string) => `Les joueurs en jeu seront prévenus. Demandé par **${user}**.`,
    rconMessage: (seconds: number, user: string) =>
      `say [Discord] Arret du serveur dans ${seconds} secondes (${user})`,
    success: {
      title: "Serveur arrêté",
      description: "Le serveur s'est arrêté proprement.",
    },
    rconError: { title: "Échec de l'arrêt" },
  },

  // ── /restart ───────────────────────────────────────────────────────────────
  restart: {
    alreadyInProgress: {
      title: "Opération déjà en cours",
      description: "Le serveur est déjà en train de démarrer ou de redémarrer.",
    },
    noRcon: {
      title: "Redémarrage impossible",
      description: "La connexion au serveur n'est pas configurée (`MC_RCON_PASSWORD` manquant).",
    },
    confirm: {
      title: "Redémarrer le serveur ?",
      playerNote: (count: number) => `**${count}** joueur(s) sont en ligne et seront prévenus avant le redémarrage.`,
      noPlayers: "Aucun joueur connecté en ce moment.",
      serverOffline: "Le serveur est hors ligne, il sera relancé.",
      confirmButton: "Confirmer le redémarrage",
      cancelButton: "Annuler",
    },
    cancelled: { title: "Annulé", description: "Le redémarrage a été annulé." },
    expired: { title: "Annulé", description: "Temps de confirmation écoulé." },
    countdownTitle: (seconds: number) => `Redémarrage dans ${seconds}s`,
    countdownDesc: (user: string) => `Demandé par **${user}**.`,
    rconMessage: (seconds: number, user: string) =>
      `say [Discord] Redémarrage du serveur dans ${seconds} secondes (${user})`,
    triggering: {
      title: "Redémarrage en cours",
      description: "Extinction du serveur...",
    },
    waitingWithRailway: {
      title: "Redémarrage en cours",
      description: "Le serveur redémarre, il sera disponible dans quelques minutes.",
    },
    waitingWithoutRailway: {
      title: "Redémarrage en cours",
      description: "Le serveur redémarre, il sera disponible dans quelques minutes.",
    },
  },

  // ── /players ───────────────────────────────────────────────────────────────
  players: {
    offline: { title: "Serveur hors ligne" },
    noPlayers: {
      title: "Aucun joueur connecté",
      description: "Le serveur tourne mais personne n'est en ligne.",
    },
    title: (online: number, max: number) => `${online} / ${max} joueur(s) en ligne`,
    noList: "La liste des joueurs n'est pas disponible.",
  },

  // ── /say ───────────────────────────────────────────────────────────────────
  say: {
    noRcon: "Impossible d'envoyer le message — le serveur n'est pas joignable.",
    serverOffline: "Le serveur est hors ligne.",
    success: (msg: string) => `Message envoyé en jeu : **${msg}**`,
    rconError: (err: string) => `Échec de l'envoi : ${err}`,
    rconCommand: (username: string, msg: string) => `say [Discord] ${username}: ${msg}`,
  },

  // ── /cmd ───────────────────────────────────────────────────────────────────
  cmd: {
    noRcon: "Impossible d'exécuter la commande — le serveur n'est pas joignable.",
    noResponse: "(aucune réponse du serveur)",
    rconError: (err: string) => `Échec de l'exécution : ${err}`,
  },

  // ── Polling (partagé entre /start et /restart) ─────────────────────────────
  poll: {
    ready: { title: "Serveur disponible" },
    inProgressTitle: (verb: string) => `${verb} en cours`,
    inProgress: (verb: string, elapsed: number) => `En attente du serveur... (${elapsed}s)`,
    timeout: (minutes: number) =>
      `Le serveur n'a pas répondu après ${minutes} minutes. Vérifie qu'il n'y a pas de problème.`,
    fields: {
      version: "Version",
      players: "Joueurs",
      start: "Démarrage",
      restart: "Redémarrage",
    },
  },

  // ── /backup ────────────────────────────────────────────────────────────────
  backup: {
    noRcon: {
      title: "Sauvegarde impossible",
      description: "La connexion au serveur n'est pas configurée (`MC_RCON_PASSWORD` manquant).",
    },
    saving: {
      title: "Sauvegarde en cours",
      description: "Le monde est en train d'être écrit sur le disque...",
    },
    success: {
      title: "Monde sauvegardé",
      description: "Toutes les données ont été écrites sur le disque. Le backup automatique inclura cette version.",
    },
    error: {
      title: "Échec de la sauvegarde",
      description: "Impossible de contacter le serveur.",
    },
  },

  // ── Commun ─────────────────────────────────────────────────────────────────
  common: {
    internalError: {
      title: "Erreur interne",
      description: "Une erreur inattendue s'est produite.",
    },
    insufficientPerms: {
      title: "Permissions insuffisantes",
      description: "Tu n'as pas la permission d'effectuer cette action.",
    },
    wrongChannel: {
      title: "Mauvais canal",
      description: (channelId: string) =>
        `Les commandes du bot ne fonctionnent que dans <#${channelId}>.`,
    },
    unknownVersion: "Inconnue",
    notAvailable: "N/A",
  },
};
