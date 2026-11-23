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

/*
 * Bills Burger : intitulés et descriptions repris de la carte publique de l'enseigne
 * (bills-burger.fr/menu), photos servies par son site. Prix fictifs, à remplacer par la carte Splash360.
 */
const smashProtein: OptionGroup = {
  id: 'bb-grp-viande',
  name: 'Viande',
  min: 1,
  max: 1,
  options: [
    { id: 'bb-opt-boeuf', name: '2 steaks de bœuf smashé', priceCents: cents(0), available: true },
    { id: 'bb-opt-crispy', name: '1 Big crispy chicken', priceCents: cents(0), available: true },
  ],
};

const smashFormula: OptionGroup = {
  id: 'bb-grp-formule',
  name: 'Formule',
  min: 1,
  max: 1,
  options: [
    { id: 'bb-opt-seul', name: 'Burger seul', priceCents: cents(0), available: true },
    { id: 'bb-opt-menu', name: 'Menu : frites + boisson', priceCents: cents(400), available: true },
  ],
};

const tastyComposition: OptionGroup = {
  id: 'bb-grp-composition',
  name: 'Composition des frites',
  min: 1,
  max: 1,
  options: [
    { id: 'bb-opt-truffe', name: 'Truffe & parmesan', priceCents: cents(0), available: true },
    { id: 'bb-opt-cheddar-bacon', name: 'Cheddar & bacon', priceCents: cents(0), available: true },
    { id: 'bb-opt-bbq', name: 'BBQ & oignons crispy', priceCents: cents(0), available: true },
  ],
};

const drinkFlavour: OptionGroup = {
  id: 'bb-grp-saveur',
  name: 'Saveur',
  min: 1,
  max: 1,
  options: [
    { id: 'bb-opt-pepsi', name: 'Pepsi', priceCents: cents(0), available: true },
    { id: 'bb-opt-pepsi-max', name: 'Pepsi Max', priceCents: cents(0), available: true },
    { id: 'bb-opt-pepsi-cherry', name: 'Pepsi Cherry', priceCents: cents(0), available: true },
  ],
};

const SMASH_BASE = 'Bun potato large, 2 steaks de bœuf smashé ou 1 Big crispy chicken';

const billsBurger: Menu = {
  restaurantId: 'S360-R-BILLS-1',
  categories: [
    { id: 'bb-cat-smash', name: 'Smash burger', position: 1 },
    { id: 'bb-cat-bon-plan', name: 'Bon plan', position: 2 },
    { id: 'bb-cat-sides', name: 'Les sides', position: 3 },
    { id: 'bb-cat-desserts', name: 'Desserts', position: 4 },
    { id: 'bb-cat-boissons', name: 'Boissons', position: 5 },
  ],
  products: [
    product({
      id: 'bb-original',
      categoryId: 'bb-cat-smash',
      name: 'Bills Original',
      description: `${SMASH_BASE}, american cheese, pickles, oignons caramélisés et sauce smash.`,
      priceCents: cents(1090),
      allergens: ['gluten', 'lait', 'moutarde'],
      optionGroups: [smashProtein, smashFormula],
    }),
    product({
      id: 'bb-smoke',
      categoryId: 'bb-cat-smash',
      name: 'Bills Smoke',
      description: `${SMASH_BASE}, bacon, american cheese, oignons caramélisés et sauce smoky.`,
      priceCents: cents(1190),
      allergens: ['gluten', 'lait', 'moutarde'],
      optionGroups: [smashProtein, smashFormula],
    }),
    product({
      id: 'bb-frenchy',
      categoryId: 'bb-cat-smash',
      name: 'Bills Frenchy',
      description: `${SMASH_BASE}, raclette fondue, oignons caramélisés, bacon fumé et sauce beef.`,
      priceCents: cents(1250),
      allergens: ['gluten', 'lait', 'moutarde'],
      optionGroups: [smashProtein, smashFormula],
    }),
    product({
      id: 'bb-farmer',
      categoryId: 'bb-cat-smash',
      name: 'Bills Farmer',
      description: `${SMASH_BASE}, american cheese, bacon, oignons caramélisés, œuf, Boursin et american sauce.`,
      priceCents: cents(1290),
      allergens: ['gluten', 'lait', 'oeufs', 'moutarde'],
      optionGroups: [smashProtein, smashFormula],
    }),
    product({
      id: 'bb-honey',
      categoryId: 'bb-cat-smash',
      name: 'Bills Honey',
      description: `${SMASH_BASE}, oignons caramélisés, fromage de chèvre fondu, miel et sauce honey.`,
      priceCents: cents(1250),
      allergens: ['gluten', 'lait', 'moutarde'],
      optionGroups: [smashProtein, smashFormula],
    }),
    product({
      id: 'bb-crispy',
      categoryId: 'bb-cat-smash',
      name: 'Bills Crispy',
      description:
        'Bun potato large, 1 Big crispy chicken, american cheese, oignons caramélisés, salade et sauce chicky.',
      priceCents: cents(1150),
      allergens: ['gluten', 'lait', 'oeufs'],
      optionGroups: [smashFormula],
    }),
    product({
      id: 'bb-kansas',
      categoryId: 'bb-cat-smash',
      name: 'Bills Kansas',
      description:
        'Pain brioché, bœuf effiloché mariné, raclette, oignons confits et sauce truffe.',
      priceCents: cents(1390),
      allergens: ['gluten', 'lait', 'oeufs'],
      imageUrl: 'https://bills-burger.fr/img/menu/smash/MENU-BILLS-KANSAS.png',
      optionGroups: [smashFormula],
    }),
    product({
      id: 'bb-tasty-golden',
      categoryId: 'bb-cat-bon-plan',
      name: 'Tasty Golden',
      description:
        'Limited Box : 3 Bills Original, 3 frites et une composition au choix : truffe & parmesan, cheddar & bacon ou BBQ & oignons crispy.',
      priceCents: cents(3490),
      allergens: ['gluten', 'lait', 'moutarde'],
      imageUrl: 'https://bills-burger.fr/img/menu/smash/tasty-golden.jpeg',
      optionGroups: [tastyComposition],
    }),
    product({
      id: 'bb-tasty',
      categoryId: 'bb-cat-bon-plan',
      name: "Bill's Tasty",
      description:
        '1 smash au choix, 1 frite et une composition au choix : truffe & parmesan, cheddar & bacon ou BBQ & oignons crispy.',
      priceCents: cents(1490),
      allergens: ['gluten', 'lait', 'moutarde'],
      imageUrl: 'https://bills-burger.fr/img/menu/smash/bills-tasty.jpeg',
      optionGroups: [smashProtein, tastyComposition],
    }),
    product({
      id: 'bb-kids',
      categoryId: 'bb-cat-bon-plan',
      name: 'Formule Mini',
      description: '1 Bills Original mini + 1 frite classique + 1 boisson + 3 churros.',
      priceCents: cents(890),
      allergens: ['gluten', 'lait'],
      optionGroups: [drinkFlavour],
    }),
    product({
      id: 'bb-cheesy-smash',
      categoryId: 'bb-cat-sides',
      name: 'Cheesy smash',
      description: null,
      priceCents: cents(590),
      allergens: ['gluten', 'lait'],
    }),
    product({
      id: 'bb-twister',
      categoryId: 'bb-cat-sides',
      name: 'Twister original',
      description: null,
      priceCents: cents(390),
      allergens: ['gluten'],
    }),
    product({
      id: 'bb-wings',
      categoryId: 'bb-cat-sides',
      name: 'Wings BBQ',
      description: null,
      priceCents: cents(690),
      allergens: ['gluten', 'moutarde'],
    }),
    product({
      id: 'bb-frites',
      categoryId: 'bb-cat-sides',
      name: 'Frites',
      description: null,
      priceCents: cents(350),
      allergens: [],
    }),
    product({
      id: 'bb-frites-cajun',
      categoryId: 'bb-cat-sides',
      name: 'Frites cajun',
      description: null,
      priceCents: cents(390),
      allergens: [],
    }),
    product({
      id: 'bb-patates-douces',
      categoryId: 'bb-cat-sides',
      name: 'Frites de patate douce',
      description: null,
      priceCents: cents(450),
      allergens: [],
    }),
    product({
      id: 'bb-frites-cheddar-bacon',
      categoryId: 'bb-cat-sides',
      name: 'Frites cheddar bacon',
      description: null,
      priceCents: cents(550),
      allergens: ['lait'],
    }),
    product({
      id: 'bb-cookie-blanc',
      categoryId: 'bb-cat-desserts',
      name: 'Cookie chocolat blanc',
      description: null,
      priceCents: cents(290),
      allergens: ['gluten', 'lait', 'oeufs'],
      imageUrl: 'https://bills-burger.fr/img/menu/dessert/cookie-chocolat-blanc.jpg',
    }),
    product({
      id: 'bb-cookie-lait',
      categoryId: 'bb-cat-desserts',
      name: 'Cookie chocolat au lait',
      description: null,
      priceCents: cents(290),
      allergens: ['gluten', 'lait', 'oeufs'],
      imageUrl: 'https://bills-burger.fr/img/menu/dessert/cookie-chocolat-au-lait.jpg',
    }),
    product({
      id: 'bb-cookie-brownie',
      categoryId: 'bb-cat-desserts',
      name: 'Cookie brownie',
      description: null,
      priceCents: cents(320),
      allergens: ['gluten', 'lait', 'oeufs'],
      imageUrl: 'https://bills-burger.fr/img/menu/dessert/cookie-brownie.jpg',
    }),
    product({
      id: 'bb-pepsi',
      categoryId: 'bb-cat-boissons',
      name: 'Pepsi 33 cl',
      description: null,
      priceCents: cents(250),
      allergens: [],
      imageUrl: 'https://bills-burger.fr/img/menu/boissons/pepsi.jpg',
    }),
    product({
      id: 'bb-pepsi-cherry',
      categoryId: 'bb-cat-boissons',
      name: 'Pepsi Cherry 33 cl',
      description: null,
      priceCents: cents(250),
      allergens: [],
      imageUrl: 'https://bills-burger.fr/img/menu/boissons/pepsi-cherry.jpg',
    }),
  ],
};

/** Photos du site de l'enseigne (bills-burger.fr) pour la démonstration (lot 11). */
const BB_IMG = 'https://storage.googleapis.com/bills-burger/menu/';
const BILLS_PHOTOS: Readonly<Record<string, string>> = {
  'bb-original': `${BB_IMG}smash/original.png`,
  'bb-smoke': `${BB_IMG}smash/smoke.png`,
  'bb-frenchy': `${BB_IMG}smash/frenchy.png`,
  'bb-farmer': `${BB_IMG}smash/bill's%20farmer.png`,
  'bb-honey': `${BB_IMG}smash/honey.png`,
  'bb-crispy': `${BB_IMG}smash/chicken.png`,
  'bb-kids': `${BB_IMG}bonPlan/etudiant.png`,
  'bb-cheesy-smash': `${BB_IMG}sides/smash.png`,
  'bb-twister': `${BB_IMG}sides/twister1.png`,
  'bb-wings': `${BB_IMG}sides/dynamite2.png`,
  'bb-frites': `${BB_IMG}sides/frites.png`,
  'bb-frites-cajun': `${BB_IMG}sides/cajun.png`,
  'bb-patates-douces': `${BB_IMG}sides/Frites%20patates%20douces.png`,
  'bb-frites-cheddar-bacon': `${BB_IMG}sides/Frites%20cheddar%20bacon.png`,
};

/** Chaque produit Bills Burger a une photo : celle du site, sinon celle du burger phare. */
const billsBurgerWithPhotos: Menu = {
  ...billsBurger,
  products: billsBurger.products.map((p) => ({
    ...p,
    imageUrl: p.imageUrl ?? BILLS_PHOTOS[p.id] ?? `${BB_IMG}smash/original.png`,
  })),
};

const MENUS = new Map(
  [bella, greenBowl, chickenStreet, billsBurgerWithPhotos].map((m) => [m.restaurantId, m]),
);

export function createDemoMenuProvider(): MenuProvider {
  return {
    fetchMenu(source) {
      const menu = MENUS.get(source.splash360RestaurantId);
      if (!menu) return Promise.reject(new MenuUnavailableError('Aucune carte de démonstration'));
      return Promise.resolve({ ...menu, restaurantId: source.restaurantId });
    },
  };
}
