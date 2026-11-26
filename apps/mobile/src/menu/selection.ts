import type { OptionGroupDto, ProductDto } from '@splash360/contracts';
import { MAX_NESTING_DEPTH, NESTED_OPTION_SEPARATOR } from '@splash360/core';

/**
 * Options choisies, par groupe. Une option choisie deux fois (`maxPerOption` > 1) apparaît deux
 * fois : c'est aussi ce qui part au serveur, qui recalcule tout.
 */
export type Selection = Readonly<Record<string, readonly string[]>>;

/** Sélection de départ : rien de coché (le client choisit lui-même, aucune option imposée). */
export function emptySelection(product: ProductDto): Selection {
  return Object.fromEntries(product.optionGroups.map((g) => [g.id, []]));
}

const chosenIn = (selection: Selection, groupId: string) => selection[groupId] ?? [];

/** Nombre de fois qu'une option est choisie. */
export function optionCount(selection: Selection, group: OptionGroupDto, optionId: string): number {
  return chosenIn(selection, group.id).filter((id) => id === optionId).length;
}

/** L'option est-elle choisie, dans quelque groupe que ce soit ? */
function isChosen(selection: Selection, optionId: string): boolean {
  return Object.values(selection).some((ids) => ids.includes(optionId));
}

/**
 * Étape imbriquée active (formules Splash360, jusqu'à trois niveaux) : son option parente est
 * choisie dans un groupe lui-même actif.
 */
function isActive(
  product: ProductDto,
  selection: Selection,
  group: OptionGroupDto,
  depth = 0,
): boolean {
  const parent = group.parentOptionId;
  if (parent === null) return true;
  if (depth > MAX_NESTING_DEPTH || !isChosen(selection, parent)) return false;
  const owner = product.optionGroups.find((g) => g.options.some((o) => o.id === parent));
  return owner !== undefined && isActive(product, selection, owner, depth + 1);
}

/**
 * Groupes proposés : tous, sauf les étapes imbriquées (formules Splash360) dont l'option parente
 * n'est pas choisie (à chaque niveau).
 */
export function activeGroups(product: ProductDto, selection: Selection): OptionGroupDto[] {
  return product.optionGroups.filter((g) => isActive(product, selection, g));
}

/** Niveau d'indentation d'un groupe dans la fiche produit : 0, puis 1 à 3 pour les étapes. */
export function groupDepth(group: OptionGroupDto): number {
  return group.parentOptionId === null
    ? 0
    : group.parentOptionId.split(NESTED_OPTION_SEPARATOR).length;
}

/**
 * Retire les choix des étapes imbriquées devenues inactives : décocher un parent vide aussi ses
 * descendants, à tous les niveaux.
 */
function pruneNested(product: ProductDto | null, selection: Selection): Selection {
  if (!product) return selection;
  let next = selection;
  for (let pass = 0; pass <= MAX_NESTING_DEPTH; pass++) {
    let changed = false;
    for (const g of product.optionGroups) {
      if (chosenIn(next, g.id).length && !isActive(product, next, g)) {
        next = { ...next, [g.id]: [] };
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}

/**
 * Coche ou décoche une option. Groupe à choix unique (max 1) : remplace le choix.
 * Groupe à choix multiples : ajoute tant que le maximum n'est pas atteint. Décocher une option
 * retire aussi les choix de l'étape imbriquée qu'elle ouvrait (`product`).
 */
export function toggleOption(
  selection: Selection,
  group: OptionGroupDto,
  optionId: string,
  product: ProductDto | null = null,
): Selection {
  const option = group.options.find((o) => o.id === optionId);
  if (!option?.available) return selection;
  const current = chosenIn(selection, group.id);
  let next: readonly string[];
  if (current.includes(optionId)) {
    next = current.filter((id) => id !== optionId);
  } else if (group.max === 1) {
    next = [optionId];
  } else if (current.length >= group.max) {
    return selection;
  } else {
    next = [...current, optionId];
  }
  return pruneNested(product, { ...selection, [group.id]: next });
}

/**
 * Stepper (même option plusieurs fois, `maxPerOption` > 1) : +1 dans la limite de l'option et
 * du groupe, −1 jusqu'à zéro.
 */
export function stepOption(
  selection: Selection,
  group: OptionGroupDto,
  optionId: string,
  delta: 1 | -1,
  product: ProductDto | null = null,
): Selection {
  const option = group.options.find((o) => o.id === optionId);
  if (!option?.available) return selection;
  const current = chosenIn(selection, group.id);
  if (delta === 1) {
    if (current.length >= group.max) return selection;
    if (optionCount(selection, group, optionId) >= group.maxPerOption) return selection;
    return { ...selection, [group.id]: [...current, optionId] };
  }
  const index = current.lastIndexOf(optionId);
  if (index < 0) return selection;
  return pruneNested(product, {
    ...selection,
    [group.id]: [...current.slice(0, index), ...current.slice(index + 1)],
  });
}

/** Groupes proposés dont le minimum n'est pas atteint (le bouton d'ajout reste grisé). */
export function missingGroups(product: ProductDto, selection: Selection): OptionGroupDto[] {
  return activeGroups(product, selection).filter((g) => chosenIn(selection, g.id).length < g.min);
}

export function selectedOptionIds(product: ProductDto, selection: Selection): string[] {
  return activeGroups(product, selection).flatMap((g) => [...chosenIn(selection, g.id)]);
}

/**
 * Prix unitaire affiché pendant la composition. Affichage seulement :
 * le serveur recalcule tout avant paiement (règle non négociable n° 1).
 */
export function displayUnitPrice(product: ProductDto, selection: Selection): number {
  return activeGroups(product, selection).reduce(
    (total, g) =>
      total +
      chosenIn(selection, g.id).reduce(
        (s, id) => s + (g.options.find((o) => o.id === id)?.priceCents ?? 0),
        0,
      ),
    product.priceCents,
  );
}
