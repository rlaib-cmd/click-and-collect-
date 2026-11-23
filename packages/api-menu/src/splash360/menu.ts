import { cents, type Menu, type MenuCategory, type MenuProduct } from '@splash360/core';
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
 * - prix TTC en centimes : `prix_c`, sinon `prix` (« 12.50 ») ; un produit sans prix est ignoré ;
 * - photo : `image.location`, rendue absolue par rapport à l'URL de l'API.
 *
 * Non traduit tant que Splash360 ne l'a pas documenté (questions-en-attente.md, n° 16) :
 * `composition`/`compo` et `steps`/`regles` (options et formules), `prixArray_c` (prix par mode),
 * `groupes_alt` (produit dans plusieurs groupes). Les produits sont donc proposés sans options.
 */
const id = z.union([z.string(), z.number()]).transform(String);
const flag = z.union([z.number(), z.boolean(), z.string()]).optional();
const image = z.object({ location: z.string().optional() }).loose().nullish();

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
            active: flag,
            visible: flag,
            weight: z.coerce.number().optional(),
            image,
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
  const { categories, groupes, produits } = parsed.data;

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
      if (!truthy(p.visible, true) || price === null) return [];
      seen.add(p.produit_id);
      const description = p.description?.trim() || p.legende?.trim() || null;
      return [
        {
          id: p.produit_id,
          categoryId: p.groupe,
          name: p.nom?.trim() || p.produit_id,
          description,
          priceCents: cents(price),
          imageUrl: imageUrl(p.image?.location, baseUrl),
          available: truthy(p.active, true),
          allergens: [],
          optionGroups: [],
        },
      ];
    });

  // Une catégorie vide n'apparaît pas dans l'application.
  const used = new Set(products.map((p) => p.categoryId));
  return {
    restaurantId,
    categories: menuCategories.filter((c) => used.has(c.id)),
    products,
  };
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
