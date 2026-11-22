import { describe, expect, it } from 'vitest';
import { addCents, cents, multiplyCents } from './money';

describe('montants en centimes', () => {
  it('additionne des montants entiers', () => {
    expect(addCents(cents(1250), cents(350), cents(0))).toBe(1600);
  });

  it('refuse un montant non entier', () => {
    expect(() => cents(12.5)).toThrow(RangeError);
  });

  it('multiplie par une quantité entière positive', () => {
    expect(multiplyCents(cents(450), 3)).toBe(1350);
    expect(() => multiplyCents(cents(450), -1)).toThrow(RangeError);
    expect(() => multiplyCents(cents(450), 1.5)).toThrow(RangeError);
  });
});
