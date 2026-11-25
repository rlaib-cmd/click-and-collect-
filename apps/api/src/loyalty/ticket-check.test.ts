import type { Splash360Sale } from '@splash360/api-menu';
import {
  createMemoryAmbassadorStore,
  createMemoryPosSalesStore,
  createMemoryRestaurantStore,
  type Restaurant,
} from '@splash360/db';
import { describe, expect, it } from 'vitest';
import {
  matchTicket,
  nextCursor,
  verifyAmbassadorTickets,
  type SalesFetchResult,
  type SalesSource,
} from './ticket-check';

/** Lot 20 (ADR 0025) : rapprochement des tickets photographiés avec l'export des ventes. */
const T = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-11-25T10:00:00Z'); // 11 h à Paris le 25
const YESTERDAY = '2026-11-24';
const TODAY = '2026-11-25';

const resto = (over: Partial<Restaurant>): Restaurant => ({
  id: '10000000-0000-4000-8000-0000000000a1',
  tenantId: T,
  name: 'Chicken Street Siège',
  splash360Id: '164',
  addressLine: '1 rue',
  postalCode: '75001',
  city: 'Paris',
  latitude: null,
  longitude: null,
  stripeAccountId: null,
  stripeChargesEnabled: false,
  status: 'active',
  splash360Live: true,
  ...over,
});

const sale = (over: Partial<Splash360Sale> = {}): Splash360Sale => ({
  ticketId: 'v-1',
  restaurantId: '164',
  jourComptable: YESTERDAY,
  numero: '6',
  status: 'confirmed',
  totalCents: 1230,
  ...over,
});

/** Export simulé : pages fixées par journée, appels mémorisés ; `fail` force une réponse. */
function fakeSource(pages: Record<string, Splash360Sale[][]>, fail?: SalesFetchResult) {
  const calls: [string, number][] = [];
  const source: SalesSource = {
    fetchPage(jour, page) {
      calls.push([jour, page]);
      if (fail) return Promise.resolve(fail);
      const list = pages[jour] ?? [];
      return Promise.resolve({
        ok: true,
        page: { sales: list[page] ?? [], hasNextPage: page < list.length - 1, skipped: 0 },
      });
    },
  };
  return { source, calls };
}

async function setup(
  tickets: { date: string; number: string; totalCents: number; tenantId?: string }[],
  restaurants: Restaurant[] = [resto({})],
) {
  const ambassador = createMemoryAmbassadorStore();
  for (const [i, t] of tickets.entries()) {
    await ambassador.createEntry(
      {
        tenantId: t.tenantId ?? T,
        memberId: `m${i}`,
        ticketRef: `REF-${i}`,
        instagramHandle: 'client',
        bonusPoints: 50,
        ticketPhoto: { date: t.date, number: t.number, totalCents: t.totalCents },
      },
      [],
    );
  }
  return {
    ambassador,
    sales: createMemoryPosSalesStore(),
    restaurants: createMemoryRestaurantStore(restaurants),
  };
}

describe('rapprochement d’un ticket (règles)', () => {
  const entry = { ticketDate: YESTERDAY, ticketNumber: '6', ticketTotalCents: 1230 };
  const ids = new Set(['164']);

  it('vente encaissée : achat vérifié, même si une annulation porte le même numéro', () => {
    expect(matchTicket(entry, [sale({ status: 'deleted' }), sale()], ids, false)?.result).toBe(
      'verified',
    );
  });

  it('seulement une vente annulée : impayé', () => {
    expect(matchTicket(entry, [sale({ status: 'deleted' })], ids, false)?.result).toBe('unpaid');
  });

  it('autre total, autre journée ou autre restaurant : pas une correspondance', () => {
    const others = [
      sale({ totalCents: 1231 }),
      sale({ jourComptable: TODAY }),
      sale({ restaurantId: '999' }),
    ];
    expect(matchTicket(entry, others, ids, false)).toBeNull();
    expect(matchTicket(entry, others, ids, true)).toEqual({ result: 'not_found', sale: null });
  });

  it('numéro comparé sans casse ni espaces', () => {
    const e = { ...entry, ticketNumber: 'a12' };
    expect(matchTicket(e, [sale({ numero: ' A12 ' })], ids, false)?.result).toBe('verified');
  });

  it('journée complète seulement après une lecture entière commencée après sa fin', () => {
    const start = { nextPage: 0, passAfterDay: false, complete: false };
    expect(nextCursor(start, 0, true, true)).toEqual({
      nextPage: 1,
      passAfterDay: true,
      complete: false,
    });
    expect(nextCursor(start, 1, false, true)).toEqual({
      nextPage: 1,
      passAfterDay: true,
      complete: true,
    });
    // Journée en cours : on relira tout, depuis le début.
    expect(nextCursor(start, 2, false, false)).toEqual(start);
  });
});

describe('vérification périodique des tickets', () => {
  it('lit une seule page par passage et vérifie l’achat une fois la vente trouvée', async () => {
    const s = await setup([{ date: YESTERDAY, number: '6', totalCents: 1230 }]);
    const fake = fakeSource({
      [YESTERDAY]: [
        [sale({ ticketId: 'a', numero: '1' })],
        [sale(), sale({ ticketId: 'x', restaurantId: '999' })],
      ],
    });
    const deps = { ...s, source: fake.source };
    const first = await verifyAmbassadorTickets(deps, NOW);
    expect(first).toMatchObject({ fetched: true, verified: 0 });
    expect(s.ambassador.entries[0]?.ticketCheck).toBe('pending');
    const second = await verifyAmbassadorTickets(deps, NOW);
    expect(second).toMatchObject({ fetched: true, verified: 1 });
    expect(fake.calls).toEqual([
      [YESTERDAY, 0],
      [YESTERDAY, 1],
    ]);
    // Seules les ventes des restaurants branchés de l'enseigne sont copiées.
    expect([...s.sales.sales.keys()]).toEqual([`${T}/a`, `${T}/v-1`]);
    expect(s.ambassador.entries[0]).toMatchObject({ ticketCheck: 'verified', status: 'pending' });
    expect(s.ambassador.history.map((h) => [h.type, h.detail])).toEqual([
      ['ticket_checked', { result: 'verified', sale: 'v-1' }],
    ]);
    // Plus rien à vérifier : aucun appel de plus.
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ fetched: false });
    expect(fake.calls).toHaveLength(2);
  });

  it('commande annulée en caisse : participation refusée automatiquement', async () => {
    const s = await setup([{ date: YESTERDAY, number: '6', totalCents: 1230 }]);
    const fake = fakeSource({ [YESTERDAY]: [[sale({ status: 'deleted' })]] });
    expect(await verifyAmbassadorTickets({ ...s, source: fake.source }, NOW)).toMatchObject({
      unpaid: 1,
    });
    expect(s.ambassador.entries[0]).toMatchObject({ ticketCheck: 'unpaid', status: 'rejected' });
    expect(s.ambassador.history.map((h) => h.type)).toEqual(['ticket_checked', 'rejected']);
    expect(s.ambassador.history[1]?.detail).toEqual({ reason: 'Commande annulée en caisse' });
  });

  it('journée terminée et lue en entier sans la vente : introuvable, à vérifier par l’équipe', async () => {
    const s = await setup([{ date: YESTERDAY, number: '7', totalCents: 1230 }]);
    const fake = fakeSource({ [YESTERDAY]: [[sale()]] });
    expect(await verifyAmbassadorTickets({ ...s, source: fake.source }, NOW)).toMatchObject({
      notFound: 1,
    });
    expect(s.ambassador.entries[0]).toMatchObject({
      ticketCheck: 'not_found',
      needsReview: true,
      status: 'pending',
    });
  });

  it('journée en cours : le ticket reste « pending » et la lecture reprend du début', async () => {
    const s = await setup([{ date: TODAY, number: '7', totalCents: 1230 }]);
    const fake = fakeSource({ [TODAY]: [[sale({ jourComptable: TODAY })]] });
    const deps = { ...s, source: fake.source };
    await verifyAmbassadorTickets(deps, NOW);
    await verifyAmbassadorTickets(deps, NOW);
    expect(fake.calls).toEqual([
      [TODAY, 0],
      [TODAY, 0],
    ]);
    expect(s.ambassador.entries[0]?.ticketCheck).toBe('pending');
    // Le lendemain, une lecture entière suffit à conclure.
    const tomorrow = new Date('2026-11-26T08:00:00Z');
    expect(await verifyAmbassadorTickets(deps, tomorrow)).toMatchObject({ notFound: 1 });
  });

  it('journée lue avant sa fin puis terminée en cours de lecture : relue en entier', async () => {
    const s = await setup([{ date: TODAY, number: '7', totalCents: 1230 }]);
    const fake = fakeSource({
      [TODAY]: [[sale({ jourComptable: TODAY })], [sale({ jourComptable: TODAY, ticketId: 'b' })]],
    });
    const deps = { ...s, source: fake.source };
    await verifyAmbassadorTickets(deps, NOW); // page 0, journée en cours
    const tomorrow = new Date('2026-11-26T08:00:00Z');
    await verifyAmbassadorTickets(deps, tomorrow); // page 1 : fin d'une lecture commencée trop tôt
    expect(s.ambassador.entries[0]?.ticketCheck).toBe('pending');
    await verifyAmbassadorTickets(deps, tomorrow); // page 0
    expect(await verifyAmbassadorTickets(deps, tomorrow)).toMatchObject({ notFound: 1 });
    expect(fake.calls.map(([, p]) => p)).toEqual([0, 1, 0, 1]);
  });

  it('la journée la plus ancienne d’abord, une page par passage, toutes enseignes', async () => {
    const s = await setup(
      [
        { date: YESTERDAY, number: '6', totalCents: 1230, tenantId: OTHER },
        { date: '2026-11-22', number: '6', totalCents: 1230 },
      ],
      [resto({}), resto({ id: '10000000-0000-4000-8000-0000000000a2', tenantId: OTHER })],
    );
    const fake = fakeSource({ '2026-11-22': [[]], [YESTERDAY]: [[sale()]] });
    const deps = { ...s, source: fake.source };
    await verifyAmbassadorTickets(deps, NOW);
    expect(fake.calls).toEqual([['2026-11-22', 0]]);
    await verifyAmbassadorTickets(deps, NOW);
    expect(fake.calls).toEqual([
      ['2026-11-22', 0],
      [YESTERDAY, 0],
    ]);
    expect(s.ambassador.entries.map((e) => [e.tenantId, e.ticketCheck])).toEqual([
      [OTHER, 'verified'],
      [T, 'not_found'],
    ]);
  });

  it('pause d’une minute (429) : passage sauté sans erreur ; panne : journalisée', async () => {
    const s = await setup([{ date: YESTERDAY, number: '6', totalCents: 1230 }]);
    const logs: string[] = [];
    const log = (m: string) => {
      logs.push(m);
    };
    const limited = fakeSource({}, { ok: false, reason: 'rate_limited', message: '429' });
    expect(await verifyAmbassadorTickets({ ...s, source: limited.source, log }, NOW)).toMatchObject(
      {
        fetched: false,
        verified: 0,
      },
    );
    expect(logs).toEqual([]);
    expect(s.sales.cursors.size).toBe(0);
    const down = fakeSource({}, { ok: false, reason: 'error', message: 'HTTP 500' });
    await verifyAmbassadorTickets({ ...s, source: down.source, log }, NOW);
    expect(logs).toEqual(['Export des ventes Splash360 indisponible']);
    expect(s.ambassador.entries[0]?.ticketCheck).toBe('pending');
  });

  it('sans accès aux ventes : ticket « pending », participation à vérifier (une seule fois)', async () => {
    for (const variant of ['no-source', 'not-live'] as const) {
      const s = await setup(
        [{ date: YESTERDAY, number: '6', totalCents: 1230 }],
        [resto({ splash360Live: variant === 'no-source' })],
      );
      const fake = fakeSource({ [YESTERDAY]: [[sale()]] });
      const deps = { ...s, source: variant === 'no-source' ? null : fake.source };
      expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({
        flagged: 1,
        fetched: false,
      });
      expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ flagged: 0 });
      expect(fake.calls).toEqual([]);
      expect(s.ambassador.entries[0]).toMatchObject({ ticketCheck: 'pending', needsReview: true });
      expect(s.ambassador.history).toHaveLength(1);
      expect(s.ambassador.history[0]?.detail).toMatchObject({ result: 'unavailable' });
    }
  });

  it('deux passages simultanés : un seul résultat enregistré', async () => {
    const s = await setup([{ date: YESTERDAY, number: '6', totalCents: 1230 }]);
    await s.sales.saveSales(T, [sale()], NOW);
    const fake = fakeSource({ [YESTERDAY]: [[sale()]] });
    const deps = { ...s, source: fake.source };
    const [a, b] = await Promise.all([
      verifyAmbassadorTickets(deps, NOW),
      verifyAmbassadorTickets(deps, NOW),
    ]);
    expect(a.verified + b.verified).toBe(1);
    expect(s.ambassador.history.filter((h) => h.type === 'ticket_checked')).toHaveLength(1);
  });
});
