import { z } from 'zod';
import { Splash360Error } from './client';

/**
 * Lecture de l'export des ventes Splash360 (`GET /api/export/orders`, format relevé le 25/11,
 * docs/api-splash360/analyse-api-click-collect.md). Lot 20 (ADR 0025) : seuls les champs utiles
 * au rapprochement d'un ticket « Ambassadeur » sont gardés ; ni client, ni lignes de vente.
 */
export interface Splash360Sale {
  /** Identifiant unique de la vente (UUID, en minuscules) : celui imprimé sur le ticket. */
  readonly ticketId: string;
  /** Identifiant Splash360 du restaurant (entier, ex. 164), en texte comme `restaurants.splash360_id`. */
  readonly restaurantId: string;
  /** Journée comptable (AAAA-MM-JJ). */
  readonly jourComptable: string;
  readonly status: 'confirmed' | 'deleted';
  /** Total TTC en centimes (l'API le donne en euros, nombre à virgule). */
  readonly totalCents: number;
}

export interface Splash360SalesPage {
  readonly sales: readonly Splash360Sale[];
  readonly hasNextPage: boolean;
  /** Ventes ignorées car incomplètes ou d'un format inattendu. */
  readonly skipped: number;
}

/** Euros (nombre à virgule) → centimes entiers, arrondi exact (12.3 → 1230, 0.29 → 29). */
export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enveloppe stricte ; ventes lues une à une (une vente illisible ne bloque pas la page). */
const envelope = z.object({
  data: z.array(z.unknown()),
  pagination: z.looseObject({ hasNextPage: z.boolean() }),
});

/** Champs utilisés, stricts ; les autres champs de la vente sont ignorés. */
const sale = z.looseObject({
  ticket_id: z.string().trim().regex(UUID),
  restaurant_id: z.number().int().nonnegative(),
  jour_comptable: z.string().regex(DATE),
  status: z.enum(['confirmed', 'deleted']),
  total: z.number().finite(),
});

/** Page de l'export des ventes ; erreur Splash360 (non réessayable) si l'enveloppe est inconnue. */
export function readSalesPage(body: unknown): Splash360SalesPage {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) {
    throw new Splash360Error('Export des ventes Splash360 illisible', 200, false);
  }
  const sales: Splash360Sale[] = [];
  let skipped = 0;
  for (const raw of parsed.data.data) {
    const s = sale.safeParse(raw);
    if (!s.success) {
      skipped += 1;
      continue;
    }
    sales.push({
      ticketId: s.data.ticket_id.toLowerCase(),
      restaurantId: String(s.data.restaurant_id),
      jourComptable: s.data.jour_comptable,
      status: s.data.status,
      totalCents: eurosToCents(s.data.total),
    });
  }
  return { sales, hasNextPage: parsed.data.pagination.hasNextPage, skipped };
}
