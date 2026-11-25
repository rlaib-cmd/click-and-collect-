import { describe, expect, it } from 'vitest';
import { savedCardPaymentRequestSchema, savedCardSchema } from './cards';

describe('cartes enregistrées', () => {
  it('n’accepte que des identifiants Stripe de carte', () => {
    expect(savedCardPaymentRequestSchema.safeParse({ paymentMethodId: 'pm_123' }).success).toBe(
      true,
    );
    for (const id of ['card_123', 'pm_', 'pm_12;drop', '4242424242424242'])
      expect(savedCardPaymentRequestSchema.safeParse({ paymentMethodId: id }).success).toBe(false);
  });

  it('accepte un retour 3-D Secure https ou par schéma d’application, jamais javascript:', () => {
    const ok = (returnUrl: string) =>
      savedCardPaymentRequestSchema.safeParse({ paymentMethodId: 'pm_1', returnUrl }).success;
    expect(ok('https://bella.example.fr/commande/1')).toBe(true);
    expect(ok('bella://stripe-redirect')).toBe(true);
    expect(ok('javascript://alert(1)')).toBe(false);
    expect(ok('data://text')).toBe(false);
    expect(ok('http://bella.example.fr')).toBe(false);
  });

  it('n’affiche que les 4 derniers chiffres', () => {
    const card = { id: 'pm_1', brand: 'visa', expMonth: 12, expYear: 2034, isDefault: true };
    expect(savedCardSchema.safeParse({ ...card, last4: '4242' }).success).toBe(true);
    expect(savedCardSchema.safeParse({ ...card, last4: '4242424242424242' }).success).toBe(false);
  });
});
