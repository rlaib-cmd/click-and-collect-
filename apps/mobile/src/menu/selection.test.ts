import type { ProductDto } from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import {
  displayUnitPrice,
  emptySelection,
  missingGroups,
  selectedOptionIds,
  toggleOption,
} from './selection';

const product: ProductDto = {
  id: 'p',
  name: 'Margherita',
  description: null,
  priceCents: 1050,
  imageUrl: null,
  available: true,
  allergens: [],
  featured: false,
  optionGroups: [
    {
      id: 'taille',
      name: 'Taille',
      required: true,
      min: 1,
      max: 1,
      options: [
        { id: 'n', name: 'Normale', priceCents: 0, available: true },
        { id: 'g', name: 'Grande', priceCents: 400, available: true },
      ],
    },
    {
      id: 'sup',
      name: 'Suppléments',
      required: false,
      min: 0,
      max: 2,
      options: [
        { id: 'a', name: 'A', priceCents: 100, available: true },
        { id: 'b', name: 'B', priceCents: 200, available: true },
        { id: 'c', name: 'C', priceCents: 300, available: true },
        { id: 'x', name: 'X', priceCents: 300, available: false },
      ],
    },
  ],
};
const [taille, sup] = product.optionGroups as [
  ProductDto['optionGroups'][0],
  ProductDto['optionGroups'][0],
];

describe('composition d’un produit', () => {
  it('exige les groupes obligatoires', () => {
    const s = emptySelection(product);
    expect(missingGroups(product, s).map((g) => g.id)).toEqual(['taille']);
    expect(missingGroups(product, toggleOption(s, taille, 'n'))).toEqual([]);
  });

  it('choix unique : remplace la sélection', () => {
    let s = toggleOption(emptySelection(product), taille, 'n');
    s = toggleOption(s, taille, 'g');
    expect(s.taille).toEqual(['g']);
  });

  it('choix multiples : bloque au maximum, décoche, ignore l’indisponible', () => {
    let s = emptySelection(product);
    s = toggleOption(s, sup, 'a');
    s = toggleOption(s, sup, 'b');
    s = toggleOption(s, sup, 'c');
    expect(s.sup).toEqual(['a', 'b']);
    s = toggleOption(s, sup, 'a');
    expect(s.sup).toEqual(['b']);
    expect(toggleOption(s, sup, 'x')).toBe(s);
  });

  it('calcule le prix affiché et la liste des options envoyées', () => {
    let s = toggleOption(emptySelection(product), taille, 'g');
    s = toggleOption(s, sup, 'b');
    expect(displayUnitPrice(product, s)).toBe(1050 + 400 + 200);
    expect(selectedOptionIds(product, s)).toEqual(['g', 'b']);
  });
});
