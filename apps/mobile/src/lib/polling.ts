const TERMINAL = new Set(['completed', 'cancelled', 'refunded']);

/** Attente de la caisse (ADR 0018) : chaque seconde tant qu'elle répond « waiting », arrêt sinon. */
export function readinessInterval(state: string | undefined, failed: boolean): number | false {
  if (failed) return false;
  return !state || state === 'waiting' ? 1000 : false;
}

/**
 * Rythme du suivi de commande : 4 s tant qu'elle attend son paiement, 30 s une fois payée ou
 * confirmée (la caisse Splash360 ne renvoie pas les étapes suivantes : un écran laissé ouvert ne
 * doit pas interroger le serveur toutes les 4 s pendant des heures), arrêt quand elle est terminée.
 */
export function trackingInterval(
  status: string | undefined,
  options: { failed?: boolean; bannerOnly?: boolean } = {},
): number | false {
  // Erreur réseau ou serveur : on ralentit (le client peut revenir), sans marteler l'API.
  if (options.failed) return 60_000;
  if (!status) return 4000;
  if (TERMINAL.has(status)) return false;
  // Le bandeau « commande en cours » masque une commande au paiement échoué : plus rien à suivre.
  if (options.bannerOnly && status === 'payment_failed') return false;
  return status === 'pending_payment' || status === 'payment_failed' ? 4000 : 30_000;
}
