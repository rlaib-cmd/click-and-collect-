import { customerSchema } from '@splash360/contracts';

export type MissingItem = 'gift' | 'name' | 'phone' | 'email' | 'member' | 'terms';

/**
 * Première chose qui empêche de commander, pour l'expliquer sous le bouton grisé.
 * null : tout est prêt. L'e-mail est facultatif, mais s'il est saisi il doit être valide.
 */
export function firstMissing(input: {
  readonly contact: { readonly name: string; readonly phone: string; readonly email: string };
  readonly terms: boolean;
  /** Paiement sur place choisi sans être connecté au club. */
  readonly needsMember: boolean;
  /** Le cadeau choisi est seul au panier : il faut au moins un article payant. */
  readonly giftAlone?: boolean;
}): MissingItem | null {
  if (input.giftAlone) return 'gift';
  const parsed = customerSchema.safeParse({ ...input.contact, marketingConsent: false });
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
    for (const f of ['name', 'phone', 'email'] as const) if (fields.has(f)) return f;
  }
  if (input.needsMember) return 'member';
  if (!input.terms) return 'terms';
  return null;
}
