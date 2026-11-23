import { describe, expect, it } from 'vitest';
import { usablePoints } from './points';

describe('points utilisables', () => {
  it('retire les points réservés par une commande en cours', () => {
    expect(usablePoints({ points: 450, reservedPoints: 400 })).toBe(50);
    expect(usablePoints({ points: 450, reservedPoints: 0 })).toBe(450);
  });

  it('ne descend jamais sous zéro', () => {
    expect(usablePoints({ points: 100, reservedPoints: 400 })).toBe(0);
  });
});
