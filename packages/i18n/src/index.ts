/** Textes de l'interface, en français. Aucune chaîne visible n'est écrite en dur dans les écrans. */
export const fr = {
  app: {
    name: 'Splash360 Commande',
    welcome: 'Bienvenue',
  },
  admin: {
    title: 'Back-office Splash360',
  },
} as const;

export type Messages = typeof fr;
export const messages: Messages = fr;
