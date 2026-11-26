import type { ProductDto } from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeGroups,
  displayUnitPrice,
  emptySelection,
  missingGroups,
  optionCount,
  selectedOptionIds,
  stepOption,
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
      maxPerOption: 1,
      parentOptionId: null,
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
      maxPerOption: 1,
      parentOptionId: null,
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

  describe('formule Splash360 : même option deux fois et étape imbriquée', () => {
    const formule: ProductDto = {
      ...product,
      optionGroups: [
        {
          id: 'sauces',
          name: 'Sauces',
          required: true,
          min: 1,
          max: 2,
          maxPerOption: 2,
          parentOptionId: null,
          options: [
            { id: 'alg', name: 'Algérienne', priceCents: 50, available: true },
            { id: 'ket', name: 'Ketchup', priceCents: 0, available: true },
          ],
        },
        {
          id: 'acc',
          name: 'Accompagnement',
          required: false,
          min: 0,
          max: 1,
          maxPerOption: 1,
          parentOptionId: null,
          options: [{ id: 'frites', name: 'Frites', priceCents: 150, available: true }],
        },
        {
          id: 'frites>sel',
          name: 'Sel',
          required: true,
          min: 1,
          max: 1,
          maxPerOption: 1,
          parentOptionId: 'frites',
          options: [{ id: 'frites>salees', name: 'Salées', priceCents: 0, available: true }],
        },
      ],
    };
    const [sauces, acc, sel] = formule.optionGroups as [
      ProductDto['optionGroups'][0],
      ProductDto['optionGroups'][0],
      ProductDto['optionGroups'][0],
    ];

    it('compteur : deux fois la même option au plus, dans la limite du groupe', () => {
      let s = emptySelection(formule);
      s = stepOption(s, sauces, 'alg', 1);
      s = stepOption(s, sauces, 'alg', 1);
      expect(optionCount(s, sauces, 'alg')).toBe(2);
      expect(stepOption(s, sauces, 'alg', 1)).toBe(s);
      expect(stepOption(s, sauces, 'ket', 1)).toBe(s);
      expect(selectedOptionIds(formule, s)).toEqual(['alg', 'alg']);
      expect(displayUnitPrice(formule, s)).toBe(1050 + 100);
      s = stepOption(s, sauces, 'alg', -1);
      expect(s.sauces).toEqual(['alg']);
    });

    it('étape imbriquée : proposée et exigée seulement avec son option parente', () => {
      let s = stepOption(emptySelection(formule), sauces, 'ket', 1);
      expect(activeGroups(formule, s).map((g) => g.id)).toEqual(['sauces', 'acc']);
      expect(missingGroups(formule, s)).toEqual([]);
      s = toggleOption(s, acc, 'frites', formule);
      expect(missingGroups(formule, s).map((g) => g.id)).toEqual(['frites>sel']);
      s = toggleOption(s, sel, 'frites>salees', formule);
      expect(selectedOptionIds(formule, s)).toEqual(['ket', 'frites', 'frites>salees']);
      // Décocher les frites retire aussi le choix de l'étape imbriquée.
      s = toggleOption(s, acc, 'frites', formule);
      expect(s['frites>sel']).toEqual([]);
      expect(selectedOptionIds(formule, s)).toEqual(['ket']);
    });
  });
});
