const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Espace insécable : le symbole € ne passe jamais seul à la ligne. */
const NBSP = '\u00a0';

/** 1050 → « 10,50 € », avec des espaces insécables (milliers et symbole). */
export function formatPrice(cents: number): string {
  return euros.format(cents / 100).replace(/\u202f|\u00a0| /g, NBSP);
}

/** Supplément : « + 3,50 € », rien si gratuit. */
export function formatSupplement(cents: number): string | null {
  return cents > 0 ? `+${NBSP}${formatPrice(cents)}` : null;
}
