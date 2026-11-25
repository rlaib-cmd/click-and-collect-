import { describe, expect, it } from 'vitest';
import { formatFrenchDate, maskFrenchDate, parseFrenchDate } from './profile';

describe('date de naissance (lot 16)', () => {
  it('convertit JJ/MM/AAAA en date ISO', () => {
    expect(parseFrenchDate('05/03/1990')).toBe('1990-03-05');
    expect(parseFrenchDate(' 5/3/1990 ')).toBe('1990-03-05');
  });

  it('champ vide : pas de date', () => {
    expect(parseFrenchDate('')).toBeNull();
    expect(parseFrenchDate('   ')).toBeNull();
  });

  it('refuse une date impossible, future ou trop ancienne', () => {
    expect(parseFrenchDate('31/02/1990')).toBe('invalid');
    expect(parseFrenchDate('1990-03-05')).toBe('invalid');
    expect(parseFrenchDate('01/01/1899')).toBe('invalid');
    expect(parseFrenchDate(`01/01/${new Date().getUTCFullYear() + 1}`)).toBe('invalid');
  });

  it('affiche et masque la saisie', () => {
    expect(formatFrenchDate('1990-03-05')).toBe('05/03/1990');
    expect(formatFrenchDate(null)).toBe('');
    expect(maskFrenchDate('0503')).toBe('05/03');
    expect(maskFrenchDate('05031990')).toBe('05/03/1990');
    expect(maskFrenchDate('05/03/19901')).toBe('05/03/1990');
  });
});
