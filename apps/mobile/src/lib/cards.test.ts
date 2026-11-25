import { describe, expect, it } from 'vitest';
import { cardLabel, sortCards } from './cards';

const card = (id: string, isDefault = false) => ({
  id,
  brand: 'visa',
  last4: '4242',
  expMonth: 1,
  expYear: 2030,
  isDefault,
});

describe('cartes enregistrées', () => {
  it('affiche la marque et les 4 derniers chiffres seulement', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242');
    expect(cardLabel({ brand: 'mastercard', last4: '4444' })).toBe('Mastercard •••• 4444');
    expect(cardLabel({ brand: 'discover', last4: '1117' })).toBe('Discover •••• 1117');
  });

  it('met la carte par défaut en premier sans changer l’ordre des autres', () => {
    expect(sortCards([card('a'), card('b'), card('c', true)]).map((c) => c.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
