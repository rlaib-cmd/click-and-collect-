import { describe, expect, it } from 'vitest';
import { formatPrice, formatSupplement } from './format';

describe('affichage des prix', () => {
  it('formate en euros à la française', () => {
    expect(formatPrice(1050)).toBe('10,50 €');
    expect(formatPrice(0)).toBe('0,00 €');
    expect(formatPrice(123456)).toBe('1 234,56 €');
  });

  it('affiche les suppléments payants seulement', () => {
    expect(formatSupplement(350)).toBe('+ 3,50 €');
    expect(formatSupplement(0)).toBeNull();
  });
});
