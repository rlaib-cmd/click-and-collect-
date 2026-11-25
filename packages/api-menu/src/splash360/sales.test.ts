import { describe, expect, it } from 'vitest';
import { Splash360Error } from './client';
import { eurosToCents, readSalesPage } from './sales';

/** Vente au format relevé le 25/11 (valeurs inventées, aucune donnée réelle). */
const sale = (over: Record<string, unknown> = {}) => ({
  ticket_id: '6f1c1c2e-0000-4000-8000-000000000001',
  local_id: '6f1c1c2e-0000-4000-8000-0000000000aa',
  numero: '6',
  chrono: 42,
  restaurant_id: 164,
  jour_comptable: '2026-11-24',
  mode: 'emporter',
  status: 'confirmed',
  total: 12.3,
  prix_ttc: 1230,
  reglements: [{ moyen: 'carte', valeur: 12.3, detail: '', reglementId: 'r1' }],
  client: { nom: 'Ne pas garder' },
  items: [{ nom: 'Burger' }],
  createdAt: '2026-11-24T12:01:00+01:00',
  ...over,
});

describe('export des ventes Splash360 (lot 20)', () => {
  it('garde seulement les champs utiles, total en centimes exacts', () => {
    const page = readSalesPage({
      data: [sale()],
      pagination: { page: 0, pageSize: 100, total: 1, totalPages: 1, hasNextPage: false },
    });
    expect(page).toEqual({
      hasNextPage: false,
      skipped: 0,
      sales: [
        {
          ticketId: '6f1c1c2e-0000-4000-8000-000000000001',
          restaurantId: '164',
          jourComptable: '2026-11-24',
          status: 'confirmed',
          totalCents: 1230,
        },
      ],
    });
  });

  it('convertit les euros en centimes sans erreur d’arrondi', () => {
    expect(eurosToCents(0.29)).toBe(29);
    expect(eurosToCents(12.3)).toBe(1230);
    expect(eurosToCents(19.99)).toBe(1999);
    expect(eurosToCents(1.005)).toBe(100);
    expect(eurosToCents(0)).toBe(0);
  });

  it('identifiant de vente en minuscules, refusé s’il n’est pas un UUID', () => {
    const page = readSalesPage({
      data: [
        sale({ ticket_id: '6F1C1C2E-0000-4000-8000-00000000000B' }),
        sale({ ticket_id: '42' }),
      ],
      pagination: { hasNextPage: false },
    });
    expect(page.sales.map((s) => s.ticketId)).toEqual(['6f1c1c2e-0000-4000-8000-00000000000b']);
    expect(page.skipped).toBe(1);
  });

  it('ignore une vente incomplète sans bloquer la page, et lit la suite', () => {
    const page = readSalesPage({
      data: [
        sale({ restaurant_id: 'x' }),
        sale({ status: 'standby' }),
        sale({ status: 'deleted', total: 5 }),
        'pas une vente',
      ],
      pagination: { hasNextPage: true },
    });
    expect(page.skipped).toBe(3);
    expect(page.hasNextPage).toBe(true);
    expect(page.sales).toEqual([expect.objectContaining({ status: 'deleted', totalCents: 500 })]);
  });

  it('refuse une enveloppe inconnue', () => {
    expect(() => readSalesPage({ orders: [] })).toThrow(Splash360Error);
    expect(() => readSalesPage(null)).toThrow(Splash360Error);
  });
});
