import { describe, expect, it } from 'vitest';
import { formatPrice, formatSupplement } from './format';

describe('affichage des prix', () => {
  it('formate en euros à la française', () => {
    expect(formatPrice(1050)).toBe('10,50\u00a0€');
    expect(formatPrice(0)).toBe('0,00\u00a0€');
    expect(formatPrice(123456)).toBe('1\u00a0234,56\u00a0€');
  });

  it('ne coupe jamais un prix en fin de ligne (€ collé au montant)', () => {
    for (const cents of [290, 1090, 123456]) expect(formatPrice(cents)).not.toMatch(/ /);
  });

  it('affiche les suppléments payants seulement', () => {
    expect(formatSupplement(350)).toBe('+\u00a03,50\u00a0€');
    expect(formatSupplement(0)).toBeNull();
  });
});
