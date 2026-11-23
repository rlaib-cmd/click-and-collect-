import { describe, expect, it } from 'vitest';
import { firstMissing } from './checkout';

const ok = { name: 'Camille', phone: '06 12 34 56 78', email: '' };

describe('ce qui manque pour commander', () => {
  it('rien quand le nom, le téléphone et les CGV y sont, même sans e-mail', () => {
    expect(firstMissing({ contact: ok, terms: true, needsMember: false })).toBeNull();
  });

  it('signale les champs dans l’ordre du formulaire', () => {
    expect(
      firstMissing({ contact: { ...ok, name: '', phone: '12' }, terms: false, needsMember: false }),
    ).toBe('name');
    expect(firstMissing({ contact: { ...ok, phone: '12' }, terms: true, needsMember: false })).toBe(
      'phone',
    );
  });

  it('un e-mail saisi doit être valide', () => {
    expect(
      firstMissing({ contact: { ...ok, email: 'camille@' }, terms: true, needsMember: false }),
    ).toBe('email');
  });

  it('demande la connexion au club pour payer sur place, puis les CGV', () => {
    expect(firstMissing({ contact: ok, terms: false, needsMember: true })).toBe('member');
    expect(firstMissing({ contact: ok, terms: false, needsMember: false })).toBe('terms');
  });
  it('bloque un cadeau seul au panier avant tout le reste', () => {
    expect(firstMissing({ contact: ok, terms: false, needsMember: false, giftAlone: true })).toBe(
      'gift',
    );
  });
});
