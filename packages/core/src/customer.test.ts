import { describe, expect, it } from 'vitest';
import { customerContactKey } from './customer';

describe('identité du client final', () => {
  it("utilise l'e-mail quand il est donné, en minuscules", () => {
    expect(customerContactKey({ email: ' Paul@Exemple.FR ', phone: '06 12 34 56 78' })).toBe(
      'email:paul@exemple.fr',
    );
  });

  it('sans e-mail, utilise le téléphone au format international', () => {
    expect(customerContactKey({ email: null, phone: '06 12 34 56 78' })).toBe('tel:+33612345678');
    expect(customerContactKey({ email: '', phone: '+33 6 12 34 56 78' })).toBe('tel:+33612345678');
  });

  it('garde un numéro étranger en chiffres', () => {
    expect(customerContactKey({ email: null, phone: '+32 470 12 34 56' })).toBe('tel:+32470123456');
  });

  it('refuse un client sans e-mail ni téléphone exploitable', () => {
    expect(customerContactKey({ email: null, phone: '' })).toBeNull();
  });
});
