import type { OptionGroupDto, ProductDto } from '@splash360/contracts';

/** Options choisies, par groupe. */
export type Selection = Readonly<Record<string, readonly string[]>>;

/** Sélection de départ : rien de coché (le client choisit lui-même, aucune option imposée). */
export function emptySelection(product: ProductDto): Selection {
  return Object.fromEntries(product.optionGroups.map((g) => [g.id, []]));
}

/**
 * Coche ou décoche une option. Groupe à choix unique (max 1) : remplace le choix.
 * Groupe à choix multiples : ajoute tant que le maximum n'est pas atteint.
 */
export function toggleOption(
  selection: Selection,
  group: OptionGroupDto,
  optionId: string,
): Selection {
  const option = group.options.find((o) => o.id === optionId);
  if (!option?.available) return selection;
  const current = selection[group.id] ?? [];
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
  return { ...selection, [group.id]: next };
}

/** Groupes dont le minimum n'est pas atteint (le bouton d'ajout reste grisé). */
export function missingGroups(product: ProductDto, selection: Selection): OptionGroupDto[] {
  return product.optionGroups.filter((g) => (selection[g.id]?.length ?? 0) < g.min);
}

export function selectedOptionIds(product: ProductDto, selection: Selection): string[] {
  return product.optionGroups.flatMap((g) => [...(selection[g.id] ?? [])]);
}

/**
 * Prix unitaire affiché pendant la composition. Affichage seulement :
 * le serveur recalcule tout avant paiement (règle non négociable n° 1).
 */
export function displayUnitPrice(product: ProductDto, selection: Selection): number {
  return product.optionGroups.reduce(
    (total, g) =>
      total +
      g.options
        .filter((o) => selection[g.id]?.includes(o.id))
        .reduce((s, o) => s + o.priceCents, 0),
    product.priceCents,
  );
}
