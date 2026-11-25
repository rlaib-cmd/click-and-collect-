const TERMINAL = new Set(['completed', 'cancelled', 'refunded']);

/**
 * Rythme du suivi de commande : 4 s tant qu'elle attend son paiement, 30 s une fois payée ou
 * confirmée (la caisse Splash360 ne renvoie pas les étapes suivantes : un écran laissé ouvert ne
 * doit pas interroger le serveur toutes les 4 s pendant des heures), arrêt quand elle est terminée.
 */
export function trackingInterval(status: string | undefined): number | false {
  if (!status) return 4000;
  if (TERMINAL.has(status)) return false;
  return status === 'pending_payment' || status === 'payment_failed' ? 4000 : 30_000;
}
