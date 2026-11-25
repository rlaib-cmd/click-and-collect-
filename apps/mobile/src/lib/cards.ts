import type { SavedCard } from '@splash360/contracts';

/** Libellé court d'une carte : « Visa •••• 4242 ». */
export function cardLabel(card: Pick<SavedCard, 'brand' | 'last4'>): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    cartes_bancaires: 'CB',
  };
  const brand = brands[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return `${brand} •••• ${card.last4}`;
}

/** Carte par défaut en premier, puis ordre d'ajout. */
export function sortCards(cards: readonly SavedCard[]): SavedCard[] {
  return [...cards].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
