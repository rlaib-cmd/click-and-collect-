/**
 * Carte Splash360 de test, construite d'après le schéma `Menu` de la documentation
 * (aucune donnée réelle). Sert aux tests de traduction.
 */
export const splash360MenuFixture = {
  tva: [{ tva_id: 'tva1', nom: 'TVA 10 %', valeur: '10', code: 'B' }],
  categories: [
    { categorie_id: 'cat2', nom: 'Boissons', catalog_id: 1, revision: 3 },
    { categorie_id: 'cat1', nom: 'Food', catalog_id: 1, revision: 3 },
  ],
  groupes: [
    { groupe_id: 'grp10', categorie: 'cat1', nom: 'Burgers', weight: 2, hidden: false },
    { groupe_id: 'grp11', categorie: 'cat1', nom: 'Accompagnements', weight: 1, hidden: false },
    { groupe_id: 'grp20', categorie: 'cat2', nom: 'Sodas', weight: 1, hidden: false },
    { groupe_id: 'grp99', categorie: 'cat1', nom: 'Composants internes', weight: 0, hidden: true },
    { groupe_id: 'grp30', categorie: 'cat1', nom: 'Groupe vide', weight: 9, hidden: false },
    { groupe_id: 'grp40', categorie: 'cat2', nom: '30 POINTS', weight: 5, hidden: false },
  ],
  produits: [
    {
      _id: 87,
      produit_id: 'prd87',
      groupe: 'grp10',
      groupes_alt: [],
      active: 1,
      visible: 1,
      nom: 'Bills Smoke',
      legende: 'Bœuf, cheddar fumé',
      description: '',
      prix: '11.90',
      prix_c: 1190,
      tva: 'tva1',
      weight: 2,
      image: {
        location: '/media/prd87.jpg',
        fileHash: 'x',
        hashAlg: 'sha1',
        type: 'image/jpeg',
      },
    },
    {
      produit_id: 'prd85',
      groupe: 'grp10',
      active: 0,
      visible: 1,
      nom: 'Bills Classic',
      description: 'Bœuf, salade, tomate',
      prix: '9,50',
      weight: 1,
      image: { location: 'https://cdn.example.test/prd85.png' },
    },
    { produit_id: 'prd1826', groupe: 'grp11', active: 1, visible: 1, nom: 'Frites', prix_c: 350 },
    { produit_id: 'prd500', groupe: 'grp20', active: 1, visible: 1, nom: 'Cola', prix_c: 250 },
    { produit_id: 'prd501', groupe: 'grp20', active: 1, visible: 0, nom: 'Masqué', prix_c: 250 },
    { produit_id: 'prd900', groupe: 'grp99', active: 1, visible: 1, nom: 'Steak', prix_c: 0 },
    { produit_id: 'prd950', groupe: 'grp40', active: 1, visible: 1, nom: 'Coca offert', prix_c: 0 },
    { produit_id: 'prd901', groupe: 'grp11', active: 1, visible: 1, nom: 'Sans prix' },
  ],
  ingredients: [],
  steps: [],
  types: [],
};
