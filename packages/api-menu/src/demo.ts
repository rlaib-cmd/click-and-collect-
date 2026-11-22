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

/** Chicken Street (démonstration) : carte fictive, à remplacer par la carte Splash360 réelle. */
const sauce: OptionGroup = {
  id: 'grp-sauce',
  name: 'Sauce',
  min: 1,
  max: 2,
  options: [
    { id: 'opt-sauce-algerienne', name: 'Algérienne', priceCents: cents(0), available: true },
    { id: 'opt-sauce-samourai', name: 'Samouraï', priceCents: cents(0), available: true },
    { id: 'opt-sauce-barbecue', name: 'Barbecue', priceCents: cents(0), available: true },
    { id: 'opt-sauce-blanche', name: 'Blanche', priceCents: cents(0), available: true },
    { id: 'opt-sauce-cheezy', name: 'Cheezy', priceCents: cents(50), available: true },
  ],
};

const supplementsChicken: OptionGroup = {
  id: 'grp-supplements-chicken',
  name: 'Suppléments',
  min: 0,
  max: 3,
  options: [
    { id: 'opt-cheddar', name: 'Cheddar', priceCents: cents(80), available: true },
    { id: 'opt-bacon-dinde', name: 'Bacon de dinde', priceCents: cents(120), available: true },
    { id: 'opt-oignons-frits', name: 'Oignons frits', priceCents: cents(60), available: true },
    { id: 'opt-jalapenos', name: 'Jalapeños', priceCents: cents(60), available: true },
  ],
};

const menuSide: OptionGroup = {
  id: 'grp-accompagnement',
  name: 'Accompagnement du menu',
  min: 1,
  max: 1,
  options: [
    { id: 'opt-frites', name: 'Frites', priceCents: cents(0), available: true },
    { id: 'opt-potatoes', name: 'Potatoes', priceCents: cents(50), available: true },
    { id: 'opt-onion-rings', name: 'Onion rings', priceCents: cents(100), available: true },
  ],
};

const menuDrink: OptionGroup = {
  id: 'grp-boisson-menu',
  name: 'Boisson du menu',
  min: 1,
  max: 1,
  options: [
    { id: 'opt-cola', name: 'Cola 33 cl', priceCents: cents(0), available: true },
    { id: 'opt-cola-zero', name: 'Cola zéro 33 cl', priceCents: cents(0), available: true },
    { id: 'opt-ice-tea', name: 'Thé glacé 33 cl', priceCents: cents(0), available: true },
    { id: 'opt-eau-plate', name: 'Eau 50 cl', priceCents: cents(0), available: true },
  ],
};

const tendersCount: OptionGroup = {
  id: 'grp-nb-tenders',
  name: 'Nombre de pièces',
  min: 1,
  max: 1,
  options: [
    { id: 'opt-tenders-4', name: '4 pièces', priceCents: cents(0), available: true },
    { id: 'opt-tenders-6', name: '6 pièces', priceCents: cents(250), available: true },
    { id: 'opt-tenders-9', name: '9 pièces', priceCents: cents(550), available: true },
  ],
};

const chickenStreet: Menu = {
  restaurantId: 'S360-R-CHICKEN-1',
  categories: [
    { id: 'cat-menus', name: 'Menus', position: 1 },
    { id: 'cat-burgers', name: 'Burgers', position: 2 },
    { id: 'cat-tenders', name: 'Tenders & wings', position: 3 },
    { id: 'cat-accompagnements', name: 'Accompagnements', position: 4 },
    { id: 'cat-desserts', name: 'Desserts', position: 5 },
    { id: 'cat-boissons', name: 'Boissons', position: 6 },
  ],
  products: [
    product({
      id: 'p-menu-classic',
      categoryId: 'cat-menus',
      name: 'Menu Chicken Classic',
      description: 'Burger poulet croustillant, accompagnement et boisson',
      priceCents: cents(1090),
      allergens: ['gluten', 'oeufs', 'moutarde'],
      optionGroups: [sauce, menuSide, menuDrink, supplementsChicken],
    }),
    product({
      id: 'p-menu-tenders',
      categoryId: 'cat-menus',
      name: 'Menu Tenders',
      description: 'Tenders de poulet, accompagnement et boisson',
      priceCents: cents(1050),
      allergens: ['gluten', 'oeufs'],
      optionGroups: [tendersCount, sauce, menuSide, menuDrink],
    }),
    product({
      id: 'p-chicken-classic',
      categoryId: 'cat-burgers',
      name: 'Chicken Classic',
      description: 'Filet de poulet pané, salade, tomate, sauce maison',
      priceCents: cents(790),
      allergens: ['gluten', 'oeufs', 'moutarde'],
      optionGroups: [sauce, supplementsChicken],
    }),
    product({
      id: 'p-chicken-spicy',
      categoryId: 'cat-burgers',
      name: 'Chicken Spicy',
      description: 'Poulet pané épicé, cheddar, jalapeños, sauce samouraï',
      priceCents: cents(850),
      allergens: ['gluten', 'oeufs', 'lait'],
      optionGroups: [sauce, supplementsChicken],
    }),
    product({
      id: 'p-double-chicken',
      categoryId: 'cat-burgers',
      name: 'Double Chicken Cheese',
      description: 'Deux filets de poulet, double cheddar, oignons frits',
      priceCents: cents(990),
      allergens: ['gluten', 'oeufs', 'lait'],
      optionGroups: [sauce, supplementsChicken],
    }),
    product({
      id: 'p-tenders',
      categoryId: 'cat-tenders',
      name: 'Tenders',
      description: 'Aiguillettes de poulet croustillantes',
      priceCents: cents(590),
      allergens: ['gluten', 'oeufs'],
      optionGroups: [tendersCount, sauce],
    }),
    product({
      id: 'p-wings',
      categoryId: 'cat-tenders',
      name: 'Wings x6',
      description: 'Ailes de poulet marinées',
      priceCents: cents(650),
      allergens: ['gluten'],
      optionGroups: [sauce],
      available: false,
    }),
    product({
      id: 'p-frites',
      categoryId: 'cat-accompagnements',
      name: 'Frites',
      description: null,
      priceCents: cents(290),
      allergens: [],
    }),
    product({
      id: 'p-potatoes',
      categoryId: 'cat-accompagnements',
      name: 'Potatoes',
      description: null,
      priceCents: cents(340),
      allergens: [],
    }),
    product({
      id: 'p-cookie',
      categoryId: 'cat-desserts',
      name: 'Cookie chocolat',
      description: null,
      priceCents: cents(250),
      allergens: ['gluten', 'lait', 'oeufs'],
    }),
    product({
      id: 'p-milkshake',
      categoryId: 'cat-desserts',
      name: 'Milkshake vanille',
      description: null,
      priceCents: cents(390),
      allergens: ['lait'],
    }),
    product({
      id: 'p-cola',
      categoryId: 'cat-boissons',
      name: 'Cola 33 cl',
      description: null,
      priceCents: cents(250),
      allergens: [],
    }),
  ],
};

const MENUS = new Map([bella, greenBowl, chickenStreet].map((m) => [m.restaurantId, m]));

export function createDemoMenuProvider(): MenuProvider {
  return {
    fetchMenu(source) {
      const menu = MENUS.get(source.splash360RestaurantId);
      if (!menu) return Promise.reject(new MenuUnavailableError('Aucune carte de démonstration'));
      return Promise.resolve({ ...menu, restaurantId: source.restaurantId });
    },
  };
}
