import { describe, expect, it } from 'vitest';
import { rewardProducts, tierHighlight, usablePoints } from './points';

describe('points utilisables', () => {
  it('retire les points réservés par une commande en cours', () => {
    expect(usablePoints({ points: 450, reservedPoints: 400 })).toBe(50);
    expect(usablePoints({ points: 450, reservedPoints: 0 })).toBe(450);
  });

  it('ne descend jamais sous zéro', () => {
    expect(usablePoints({ points: 100, reservedPoints: 400 })).toBe(0);
  });
});

describe('produits d’un palier (lot 16)', () => {
  const p = (id: string, available = true) => ({ id, available });
  const categories = [
    { id: 'cat-boissons', products: [p('pepsi'), p('eau'), p('jus', false)] },
    { id: 'cat-desserts', products: [p('cookie'), p('tiramisu')] },
    { id: 'cat-burgers', products: [p('smash')] },
  ];
  it('liste les produits fixés puis toute la catégorie, disponibles et sans doublon', () => {
    expect(
      rewardProducts({ productIds: ['cookie'], categoryIds: ['cat-boissons'] }, categories).map(
        (x) => x.id,
      ),
    ).toEqual(['cookie', 'pepsi', 'eau']);
    expect(
      rewardProducts({ productIds: ['pepsi'], categoryIds: ['cat-boissons'] }, categories).map(
        (x) => x.id,
      ),
    ).toEqual(['pepsi', 'eau']);
    expect(rewardProducts({ productIds: ['inconnu'] }, categories)).toEqual([]);
  });

  it('met en avant le palier débloqué le plus généreux, sinon le prochain', () => {
    const rewards = [
      { id: 'side', costPoints: 400 },
      { id: 'boisson', costPoints: 500 },
      { id: 'burger', costPoints: 900 },
    ];
    expect(tierHighlight(rewards, 650)).toEqual({
      kind: 'unlocked',
      reward: rewards[1],
      points: 650,
    });
    expect(tierHighlight(rewards, 120)).toEqual({
      kind: 'next',
      reward: rewards[0],
      missing: 280,
      points: 120,
    });
    expect(tierHighlight([], 120)).toBeNull();
  });
});
