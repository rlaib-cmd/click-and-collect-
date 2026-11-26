import {
  cents,
  nestedOptionId,
  type Menu,
  type MenuCategory,
  type MenuProduct,
  type ModePrices,
  type OptionGroup,
} from '@splash360/core';
import { z } from 'zod';
import { MenuUnavailableError, type MenuProvider } from '../provider';
import type { Splash360Client } from './client';

/**
 * Traduction de la carte Splash360 (`GET /api/export/menus`, schéma `Menu`) vers les types internes.
 *
 * Correspondance retenue (ADR 0018) :
 * - les `groupes` (Burgers, Boissons…) deviennent nos catégories, dans l'ordre de leur `categorie`
 *   parente puis de leur `weight` ; un groupe `hidden` et ses produits ne sont pas affichés ;
 * - un produit `visible: 0` est ignoré, `active: 0` le montre « indisponible » ;
 * - prix TTC en centimes : `prix_c`, sinon `prix` (« 12.50 ») ; un produit sans prix ou à 0 € est
 *   ignoré : ce sont les cadeaux fidélité de la caisse (groupes « 30 POINTS »…), qui ne doivent pas
 *   pouvoir être commandés gratuitement ;
 * - photo : `image.location`, rendue absolue par rapport à l'URL de l'API ;
 * - libellé affiché : `legende` (texte client, avec ses pictos), sinon `nom` (libellé du ticket de
 *   caisse : « ###   S   ### » pour « Sauce Sucrée » dans la carte réelle Tasty Crousty) ;
 * - options et formules : étapes v2 (`steps`/`regles`, `buildOptionGroups`, lot 19, ADR 0024) ;
 * - prix par mode (réponses de Splash360 du 26/11) : `prixArray_c` et `supplementArray_c` sont
 *   dans l'ordre [sur place, à emporter, livraison, Uber, Deliveroo] ; à emporter = entrée 1,
 *   livraison = entrée 2 (`ttc`), sinon `prix_c` / `supplement_c` ;
 * - `max_par_produit` : nombre de fois qu'une même option peut être choisie ;
 * - étapes imbriquées (`steps[].produit` = « ing…-typ… ») : groupes rattachés à l'option parente.
 *
 * Non traduit (questions-en-attente.md) : `composition`/`compo`, `groupes_alt`, `gifts` et
 * `reglescatalogue` (promotions de la caisse, forme insuffisante pour les appliquer en ligne).
 */
const id = z.union([z.string(), z.number()]).transform(String);
const flag = z.union([z.number(), z.boolean(), z.string()]).optional();
const image = z.object({ location: z.string().optional() }).loose().nullish();
/** Prix par mode (`prixArray_c`, `supplementArray_c`) : une entrée illisible est ignorée. */
const modeArray = z
  .array(
    z
      .union([
        z.object({ ttc: z.coerce.number().nullish() }).loose(),
        // Forme réduite (prix TTC seul), celle de l'extrait de carte des tests.
        z.number().transform((ttc) => ({ ttc })),
      ])
      .nullish()
      .catch(null),
  )
  .nullish()
  .catch(null);

const schema = z
  .object({
    categories: z
      .array(z.object({ categorie_id: id, nom: z.string().optional() }).loose())
      .default([]),
    groupes: z
      .array(
        z
          .object({
            groupe_id: id,
            categorie: id.optional(),
            nom: z.string().optional(),
            weight: z.coerce.number().optional(),
            hidden: flag,
          })
          .loose(),
      )
      .default([]),
    produits: z
      .array(
        z
          .object({
            produit_id: id,
            groupe: id.optional(),
            nom: z.string().optional(),
            description: z.string().nullish(),
            legende: z.string().nullish(),
            prix: z.union([z.string(), z.number()]).nullish(),
            prix_c: z.coerce.number().nullish(),
            prixArray_c: modeArray,
            active: flag,
            visible: flag,
            weight: z.coerce.number().optional(),
            image,
          })
          .loose(),
      )
      .default([]),
    // Carte v2 (lot 19) : personnalisations, leurs ingrédients et les étapes de chaque produit.
    types: z.array(z.object({ type_id: id, nom: z.string().optional() }).loose()).default([]),
    ingredients: z
      .array(
        z
          .object({
            ingredient_id: id,
            type: id.optional(),
            nom: z.string().optional(),
            legende: z.string().nullish(),
            supplement_c: z.coerce.number().nullish(),
            supplement: z.union([z.string(), z.number()]).nullish(),
            supplementArray_c: modeArray,
            active: flag,
            visible: flag,
            weight: z.coerce.number().optional(),
          })
          .loose(),
      )
      .default([]),
    steps: z
      .array(
        z
          .object({
            produit: id,
            regles: z
              .array(
                z
                  .object({
                    type: id,
                    min: z.coerce.number().int().nonnegative().optional(),
                    max: z.coerce.number().int().nonnegative().optional(),
                    max_par_produit: z.coerce
                      .number()
                      .int()
                      .nonnegative()
                      .optional()
                      .catch(undefined),
                    supplement_c: z.coerce.number().nullish(),
                  })
                  .loose(),
              )
              .default([]),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

/** 1, true, « 1 » → vrai ; 0, false, « 0 » → faux ; absent → valeur par défaut. */
function truthy(value: number | boolean | string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const v = value.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === '');
}

function priceCents(prixC: number | null | undefined, prix: string | number | null | undefined) {
  if (typeof prixC === 'number' && Number.isInteger(prixC) && prixC >= 0) return prixC;
  if (prix === null || prix === undefined) return null;
  const n = typeof prix === 'number' ? prix : Number(prix.replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Ordre de `prixArray_c` (réponse de Splash360 du 26/11). */
export const SPLASH360_MODE_INDEX = { surplace: 0, pickup: 1, delivery: 2, uber: 3, deliveroo: 4 };

type ModeArray = z.infer<typeof modeArray>;

function modeCents(array: ModeArray, index: number): number | null {
  const v = array?.[index]?.ttc;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Prix à emporter et en livraison ; une entrée absente (tableau absent ou trop court) reprend le
 * prix de base. `extra` (supplément de la règle) s'ajoute aux deux.
 */
export function modePrices(array: ModeArray, base: number, extra = 0): ModePrices {
  return {
    pickup: cents((modeCents(array, SPLASH360_MODE_INDEX.pickup) ?? base) + extra),
    delivery: cents((modeCents(array, SPLASH360_MODE_INDEX.delivery) ?? base) + extra),
  };
}

function imageUrl(location: string | undefined, baseUrl: string): string | null {
  if (!location) return null;
  try {
    const url = new URL(location, `${baseUrl.replace(/\/+$/, '')}/`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toMenu(raw: unknown, restaurantId: string, baseUrl: string): Menu {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new MenuUnavailableError('Carte Splash360 illisible', parsed.error);
  const { categories, groupes, produits, types, ingredients, steps } = parsed.data;
  const optionGroupsOf = buildOptionGroups(types, ingredients, steps);

  const parentRank = new Map(categories.map((c, i) => [c.categorie_id, i]));
  const shown = groupes
    .map((g, index) => ({ g, index }))
    .filter(({ g }) => !truthy(g.hidden, false))
    .sort(
      (a, b) =>
        (parentRank.get(a.g.categorie ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (parentRank.get(b.g.categorie ?? '') ?? Number.MAX_SAFE_INTEGER) ||
        (a.g.weight ?? 0) - (b.g.weight ?? 0) ||
        a.index - b.index,
    );
  const menuCategories: MenuCategory[] = shown.map(({ g }, i) => ({
    id: g.groupe_id,
    name: g.nom?.trim() || 'Carte',
    position: i + 1,
  }));
  const known = new Set(menuCategories.map((c) => c.id));

  const seen = new Set<string>();
  const products: MenuProduct[] = produits
    .map((p, index) => ({ p, index }))
    .sort((a, b) => (a.p.weight ?? 0) - (b.p.weight ?? 0) || a.index - b.index)
    .flatMap(({ p }) => {
      const price = priceCents(p.prix_c, p.prix);
      if (!p.groupe || !known.has(p.groupe) || seen.has(p.produit_id)) return [];
      if (!truthy(p.visible, true) || price === null || price <= 0) return [];
      seen.add(p.produit_id);
      const description = p.description?.trim() || null;
      return [
        {
          id: p.produit_id,
          categoryId: p.groupe,
          name: p.legende?.trim() || p.nom?.trim() || p.produit_id,
          description,
          priceCents: cents(price),
          modePrices: modePrices(p.prixArray_c, price),
          imageUrl: imageUrl(p.image?.location, baseUrl),
          // Une étape imbriquée n'est exigée que si son option parente est choisie.
          available:
            truthy(p.active, true) &&
            optionGroupsOf(p.produit_id)
              .filter((g) => !g.parentOptionId)
              .every(satisfiable),
          allergens: [],
          optionGroups: optionGroupsOf(p.produit_id),
        },
      ];
    });

  // Une catégorie vide n'apparaît pas dans l'application.
  const used = new Set(products.map((p) => p.categoryId));
  return {
    restaurantId,
    categories: menuCategories
      .filter((c) => used.has(c.id))
      .map((c, index) => ({ ...c, position: index + 1 })),
    products,
  };
}

type Parsed = z.infer<typeof schema>;

/** Un choix obligatoire sans assez d'options disponibles rend le produit indisponible. */
function satisfiable(g: OptionGroup): boolean {
  return g.options.filter((o) => o.available).length >= g.min;
}

/**
 * Étapes Splash360 → groupes d'options (consignes Splash360 du 25/11 et du 26/11, ADR 0024) :
 * chaque règle d'une étape vise une personnalisation (`types`) ; ses options sont les ingrédients
 * de ce type, dans l'ordre des règles ; min/max viennent de la règle, `max_par_produit` donne le
 * nombre de fois qu'une même option peut être choisie. Prix d'une option : son supplément (par
 * mode), plus celui de la règle (nul partout dans les cartes réelles). Identifiant d'option :
 * `ingredient_id` complet, tel que reçu.
 *
 * Étape imbriquée (`steps[].produit` = identifiant d'ingrédient) : ses groupes suivent le groupe
 * de l'option parente, avec `parentOptionId` et des identifiants préfixés (`nestedOptionId`), pour
 * que la caisse reçoive `parentid`. Un seul niveau : l'étape d'une option déjà imbriquée est ignorée.
 */
function buildOptionGroups(
  types: Parsed['types'],
  ingredients: Parsed['ingredients'],
  steps: Parsed['steps'],
): (productId: string) => OptionGroup[] {
  const typeName = new Map(types.map((t) => [t.type_id, t.nom?.trim() || 'Choix']));
  const byType = new Map<string, Parsed['ingredients']>();
  for (const i of ingredients) {
    if (!i.type || !truthy(i.visible, true)) continue;
    const list = byType.get(i.type) ?? [];
    if (!list.some((x) => x.ingredient_id === i.ingredient_id)) list.push(i);
    byType.set(i.type, list);
  }
  const byOwner = new Map(steps.map((st) => [st.produit, st]));

  function groupsOf(ownerId: string, parentOptionId: string | null): OptionGroup[] {
    const step = byOwner.get(ownerId);
    if (!step) return [];
    const prefix = (id: string) => (parentOptionId ? nestedOptionId(parentOptionId, id) : id);
    return step.regles.flatMap((r) => {
      const extra = Math.max(0, r.supplement_c ?? 0);
      const options = (byType.get(r.type) ?? [])
        .map((i, index) => ({ i, index }))
        .sort((a, b) => (a.i.weight ?? 0) - (b.i.weight ?? 0) || a.index - b.index)
        .map(({ i }) => {
          const base = priceCents(i.supplement_c, i.supplement) ?? 0;
          return {
            id: prefix(i.ingredient_id),
            name: i.legende?.trim() || i.nom?.trim() || i.ingredient_id,
            priceCents: cents(base + extra),
            modePrices: modePrices(i.supplementArray_c, base, extra),
            available: truthy(i.active, true),
          };
        });
      if (options.length === 0) return [];
      const min = Math.min(r.min ?? 0, options.length * Math.max(1, r.max_par_produit ?? 1));
      const max = Math.max(min, r.max ?? options.length);
      const perOption = Math.max(1, Math.min(r.max_par_produit ?? 1, max));
      const group: OptionGroup = {
        id: prefix(r.type),
        name: typeName.get(r.type) ?? 'Choix',
        min,
        max: Math.min(max, options.length * perOption),
        ...(perOption > 1 ? { maxPerOption: perOption } : {}),
        ...(parentOptionId ? { parentOptionId } : {}),
        options,
      };
      if (parentOptionId) return [group];
      // Étapes imbriquées des options de ce groupe, juste après lui.
      const nested = (byType.get(r.type) ?? []).flatMap((i) =>
        groupsOf(i.ingredient_id, i.ingredient_id),
      );
      return [group, ...nested];
    });
  }
  return (productId) => groupsOf(productId, null);
}

/** Carte réelle : une lecture de l'API par rafraîchissement du cache (`createMenuCache`). */
export function createSplash360MenuProvider(
  client: Splash360Client,
  baseUrl: string,
): MenuProvider {
  return {
    async fetchMenu(source) {
      try {
        return toMenu(await client.getMenus(), source.restaurantId, baseUrl);
      } catch (error) {
        if (error instanceof MenuUnavailableError) throw error;
        throw new MenuUnavailableError('API menu Splash360 indisponible', error);
      }
    },
  };
}
