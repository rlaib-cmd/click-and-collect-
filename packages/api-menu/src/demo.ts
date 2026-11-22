import { cents, type Menu, type MenuProduct, type OptionGroup } from '@splash360/core';
import { MenuUnavailableError, type MenuProvider } from './provider';

/**
 * Cartes de démonstration, utilisées tant que l'API menu Splash360 n'est pas branchée
 * (développement, recette, tests). Identifiants alignés sur supabase/seed.sql.
 */
const size: OptionGroup = {
  id: 'grp-taille',
  name: 'Taille',
  min: 1,
  max: 1,
  options: [
    { id: 'opt-normale', name: 'Normale (31 cm)', priceCents: cents(0), available: true },
    { id: 'opt-grande', name: 'Grande (40 cm)', priceCents: cents(400), available: true },
  ],
};

const toppings: OptionGroup = {
  id: 'grp-supplements',
  name: 'Suppléments',
  min: 0,
  max: 3,
  options: [
    { id: 'opt-burrata', name: 'Burrata', priceCents: cents(350), available: true },
    { id: 'opt-jambon', name: 'Jambon de Parme', priceCents: cents(250), available: true },
    { id: 'opt-roquette', name: 'Roquette', priceCents: cents(100), available: true },
    { id: 'opt-truffe', name: 'Crème de truffe', priceCents: cents(450), available: false },
  ],
};

const drinkChoice: OptionGroup = {
  id: 'grp-boisson',
  name: 'Boisson du menu',
  min: 1,
  max: 1,
  options: [
    { id: 'opt-eau', name: 'Eau pétillante', priceCents: cents(0), available: true },
    { id: 'opt-soda', name: 'Soda', priceCents: cents(0), available: true },
    { id: 'opt-biere', name: 'Bière italienne', priceCents: cents(150), available: true },
  ],
};

function product(
  p: Omit<MenuProduct, 'imageUrl' | 'available' | 'optionGroups'> & Partial<MenuProduct>,
): MenuProduct {
  return { imageUrl: null, available: true, optionGroups: [], ...p };
}

const bella: Menu = {
  restaurantId: 'S360-R-BELLA-1',
  categories: [
    { id: 'cat-pizzas', name: 'Pizzas', position: 1 },
    { id: 'cat-menus', name: 'Menus', position: 2 },
    { id: 'cat-desserts', name: 'Desserts', position: 3 },
    { id: 'cat-boissons', name: 'Boissons', position: 4 },
  ],
  products: [
    product({
      id: 'p-margherita',
      categoryId: 'cat-pizzas',
      name: 'Margherita',
      description: 'Tomate San Marzano, fior di latte, basilic',
      priceCents: cents(1050),
      allergens: ['gluten', 'lait'],
      optionGroups: [size, toppings],
    }),
    product({
      id: 'p-regina',
      categoryId: 'cat-pizzas',
      name: 'Regina',
      description: 'Tomate, mozzarella, jambon, champignons',
      priceCents: cents(1290),
      allergens: ['gluten', 'lait'],
      optionGroups: [size, toppings],
    }),
    product({
      id: 'p-diavola',
      categoryId: 'cat-pizzas',
      name: 'Diavola',
      description: 'Tomate, mozzarella, salami piquant',
      priceCents: cents(1350),
      allergens: ['gluten', 'lait'],
      optionGroups: [size, toppings],
      available: false,
    }),
    product({
      id: 'p-menu-midi',
      categoryId: 'cat-menus',
      name: 'Menu midi',
      description: 'Une pizza Margherita et une boisson',
      priceCents: cents(1390),
      allergens: ['gluten', 'lait'],
      optionGroups: [size, drinkChoice],
    }),
    product({
      id: 'p-tiramisu',
      categoryId: 'cat-desserts',
      name: 'Tiramisu maison',
      description: null,
      priceCents: cents(650),
      allergens: ['gluten', 'lait', 'oeufs'],
    }),
    product({
      id: 'p-eau',
      categoryId: 'cat-boissons',
      name: 'San Pellegrino 50 cl',
      description: null,
      priceCents: cents(350),
      allergens: [],
    }),
  ],
};

const greenBowl: Menu = {
  restaurantId: 'S360-R-GREEN-1',
  categories: [
    { id: 'cat-bowls', name: 'Bowls', position: 1 },
    { id: 'cat-jus', name: 'Jus pressés', position: 2 },
  ],
  products: [
    product({
      id: 'p-bowl-poulet',
      categoryId: 'cat-bowls',
      name: 'Bowl poulet teriyaki',
      description: 'Riz, poulet mariné, edamame, avocat',
      priceCents: cents(1290),
      allergens: ['soja', 'sesame'],
      optionGroups: [
        {
          id: 'grp-base',
          name: 'Base',
          min: 1,
          max: 1,
          options: [
            { id: 'opt-riz', name: 'Riz vinaigré', priceCents: cents(0), available: true },
            { id: 'opt-quinoa', name: 'Quinoa', priceCents: cents(50), available: true },
          ],
        },
        {
          id: 'grp-toppings',
          name: 'Toppings',
          min: 0,
          max: 2,
          options: [
            { id: 'opt-avocat', name: 'Avocat en plus', priceCents: cents(200), available: true },
            { id: 'opt-oeuf', name: 'Œuf mollet', priceCents: cents(150), available: true },
          ],
        },
      ],
    }),
    product({
      id: 'p-bowl-veggie',
      categoryId: 'cat-bowls',
      name: 'Bowl végétarien',
      description: 'Quinoa, falafels, houmous, crudités',
      priceCents: cents(1190),
      allergens: ['sesame'],
    }),
    product({
      id: 'p-jus-detox',
      categoryId: 'cat-jus',
      name: 'Jus détox',
      description: 'Pomme, concombre, citron, gingembre',
      priceCents: cents(550),
      allergens: [],
    }),
  ],
};

const MENUS = new Map([bella, greenBowl].map((m) => [m.restaurantId, m]));

export function createDemoMenuProvider(): MenuProvider {
  return {
    fetchMenu(source) {
      const menu = MENUS.get(source.splash360RestaurantId);
      if (!menu) return Promise.reject(new MenuUnavailableError('Aucune carte de démonstration'));
      return Promise.resolve({ ...menu, restaurantId: source.restaurantId });
    },
  };
}
