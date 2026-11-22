/** Textes de l'interface, en français. Aucune chaîne visible n'est écrite en dur dans les écrans. */
export const fr = {
  app: {
    name: 'Splash360 Commande',
    welcome: 'Bienvenue',
    loading: 'Chargement…',
    retry: 'Réessayer',
    order: 'Commander',
    logoAlt: (name: string) => `Logo de ${name}`,
  },
  tenant: {
    networkError: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
    notFound: 'Cette enseigne est introuvable.',
    suspended: 'La commande en ligne de cette enseigne est momentanément indisponible.',
    missing: "Aucune enseigne n'est configurée pour cette application.",
  },
  admin: {
    title: 'Back-office Splash360',
  },
} as const;

export type Messages = typeof fr;
export const messages: Messages = fr;
