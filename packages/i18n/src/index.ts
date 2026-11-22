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
  menu: {
    title: 'Carte',
    unavailable: 'Indisponible',
    staleNotice: 'Carte en cours de mise à jour : certains prix peuvent avoir changé.',
    menuError: 'La carte est momentanément indisponible.',
    chooseRestaurant: 'Choisissez votre restaurant',
    paused: 'Commande en pause',
    noPhoto: 'Pas de photo',
  },
  product: {
    required: 'Obligatoire',
    optional: 'Facultatif',
    chooseOne: 'Choisissez 1 option',
    chooseBetween: (min: number, max: number) =>
      min === max ? `Choisissez ${min} options` : `Choisissez de ${min} à ${max} options`,
    upTo: (max: number) => `Jusqu'à ${max} au choix`,
    instructions: 'Instructions particulières',
    instructionsPlaceholder: 'Ex. : bien cuite, sans oignon…',
    allergens: 'Allergènes',
    noAllergens: 'Aucun allergène majeur déclaré.',
    add: (price: string) => `Ajouter · ${price}`,
    missing: (group: string) => `Choisissez : ${group}`,
    decrease: 'Retirer un',
    increase: 'Ajouter un',
    quantity: (n: number) => `Quantité : ${n}`,
    notFound: 'Ce produit n’est plus à la carte.',
    close: 'Fermer',
  },
  cart: {
    title: 'Panier',
    view: (count: number, price: string) => `Voir le panier (${count}) · ${price}`,
    empty: 'Votre panier est vide.',
    addMore: 'Ajouter des articles',
    subtotal: 'Sous-total',
    remove: 'Supprimer',
    unknownItem: 'Article retiré de la carte',
    checkout: 'Continuer',
  },
  admin: {
    title: 'Back-office Splash360',
  },
} as const;

export type Messages = typeof fr;
export const messages: Messages = fr;
