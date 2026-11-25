import type { Splash360Sale } from '@splash360/api-menu';
import {
  createMemoryAmbassadorStore,
  createMemoryPosSalesStore,
  createMemoryRestaurantStore,
  type Restaurant,
  type VerifiableTicket,
} from '@splash360/db';
import { describe, expect, it } from 'vitest';
import {
  matchTicket,
  nextCursor,
  ticketBusinessDays,
  verifyAmbassadorTickets,
  type SalesFetchResult,
  type SalesSource,
} from './ticket-check';

/** Lot 20 (ADR 0025) : rapprochement par `ticket_id` avec l'export des ventes (pages dès 1). */
const T = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-11-25T10:00:00Z'); // 11 h à Paris le 25
const YESTERDAY = '2026-11-24';
const TODAY = '2026-11-25';
const id = (n: number) => `6f1c1c2e-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
  ticketId: id(1),
  restaurantId: '164',
  jourComptable: YESTERDAY,
  status: 'confirmed',
  totalCents: 1230,
  ...over,
});

/** Export simulé : pages (à partir de 0) par journée, appels mémorisés ; `fail` force une réponse. */
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

const photo = (over: Partial<VerifiableTicket> = {}): VerifiableTicket => ({
  ticketId: id(1),
  date: YESTERDAY,
  time: '12:41',
  totalCents: 1230,
  ...over,
});

async function setup(
  tickets: (VerifiableTicket & { tenantId?: string })[],
  restaurants: Restaurant[] = [resto({})],
) {
  const ambassador = createMemoryAmbassadorStore();
  for (const [i, { tenantId, ...ticket }] of tickets.entries()) {
    await ambassador.createEntry(
      {
        tenantId: tenantId ?? T,
        memberId: `m${i}`,
        ticketRef: ticket.ticketId.toUpperCase(),
        instagramHandle: 'client',
        bonusPoints: 50,
        ticket,
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
  const entry = { ticketId: id(1), ticketTotalCents: 1230 };
  const ids = new Set(['164']);

  it('vente encaissée : achat vérifié ; annulée : impayé ; sans casse', () => {
    expect(matchTicket(entry, sale(), ids, false)?.result).toBe('verified');
    expect(matchTicket(entry, sale({ status: 'deleted' }), ids, false)?.result).toBe('unpaid');
    const upper = { ...entry, ticketId: id(1).toUpperCase() };
    expect(matchTicket(upper, sale(), ids, false)?.result).toBe('verified');
  });

  it('total différent : vérifié quand même, écart signalé', () => {
    expect(matchTicket(entry, sale({ totalCents: 990 }), ids, false)).toMatchObject({
      result: 'verified',
      totalDiffers: true,
    });
    expect(
      matchTicket({ ...entry, ticketTotalCents: null }, sale({ totalCents: 990 }), ids, false),
    ).toMatchObject({ totalDiffers: false });
  });

  it('autre restaurant ou vente absente : introuvable seulement journées complètes', () => {
    expect(matchTicket(entry, sale({ restaurantId: '999' }), ids, false)).toBeNull();
    expect(matchTicket(entry, null, ids, false)).toBeNull();
    expect(matchTicket(entry, null, ids, true)).toMatchObject({ result: 'not_found' });
  });

  it('journées à lire : heure lue, heure illisible (date et veille), QR (participation et veille)', () => {
    const at = new Date('2026-11-25T10:00:00Z');
    expect(ticketBusinessDays({ ticketDate: TODAY, ticketTime: '01:59', createdAt: at })).toEqual([
      YESTERDAY,
    ]);
    expect(ticketBusinessDays({ ticketDate: TODAY, ticketTime: '02:00', createdAt: at })).toEqual([
      TODAY,
    ]);
    expect(ticketBusinessDays({ ticketDate: TODAY, ticketTime: null, createdAt: at })).toEqual([
      YESTERDAY,
      TODAY,
    ]);
    expect(ticketBusinessDays({ ticketDate: null, ticketTime: null, createdAt: at })).toEqual([
      YESTERDAY,
      TODAY,
    ]);
    // QR scanné à 01:30 le 25 : journée comptable du 24, et le 23.
    const night = new Date('2026-11-25T00:30:00Z');
    expect(ticketBusinessDays({ ticketDate: null, ticketTime: null, createdAt: night })).toEqual([
      '2026-11-23',
      YESTERDAY,
    ]);
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
    // Journée en cours : on relira tout, depuis la page 0.
    expect(nextCursor(start, 2, false, false)).toEqual(start);
  });
});

describe('vérification périodique des tickets', () => {
  it('lit une seule page par passage, dès la page 0, et vérifie l’achat une fois la vente trouvée', async () => {
    const s = await setup([photo()]);
    const fake = fakeSource({
      [YESTERDAY]: [
        [sale({ ticketId: id(9) })],
        [sale(), sale({ ticketId: id(8), restaurantId: '999' })],
      ],
    });
    const deps = { ...s, source: fake.source };
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ fetched: true, verified: 0 });
    expect(s.ambassador.entries[0]?.ticketCheck).toBe('pending');
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ fetched: true, verified: 1 });
    expect(fake.calls).toEqual([
      [YESTERDAY, 0],
      [YESTERDAY, 1],
    ]);
    // Seules les ventes des restaurants branchés de l'enseigne sont copiées.
    expect([...s.sales.sales.keys()]).toEqual([`${T}/${id(9)}`, `${T}/${id(1)}`]);
    expect(s.ambassador.entries[0]).toMatchObject({ ticketCheck: 'verified', status: 'pending' });
    expect(s.ambassador.history.map((h) => [h.type, h.detail])).toEqual([
      ['ticket_checked', { result: 'verified', jour: YESTERDAY }],
    ]);
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ fetched: false });
    expect(fake.calls).toHaveLength(2);
  });

  it('vente déjà copiée sur une autre journée : retrouvée quand même, écart de total journalisé', async () => {
    const s = await setup([photo({ totalCents: 1500 })]);
    await s.sales.saveSales(T, [sale({ jourComptable: '2026-11-20' })], NOW);
    const fake = fakeSource({});
    expect(await verifyAmbassadorTickets({ ...s, source: fake.source }, NOW)).toMatchObject({
      verified: 1,
    });
    expect(s.ambassador.history[0]?.detail).toEqual({
      result: 'verified',
      jour: '2026-11-20',
      saleTotalCents: 1230,
      totalDiffers: true,
    });
  });

  it('commande annulée en caisse : participation refusée automatiquement', async () => {
    const s = await setup([photo()]);
    const fake = fakeSource({ [YESTERDAY]: [[sale({ status: 'deleted' })]] });
    expect(await verifyAmbassadorTickets({ ...s, source: fake.source }, NOW)).toMatchObject({
      unpaid: 1,
    });
    expect(s.ambassador.entries[0]).toMatchObject({ ticketCheck: 'unpaid', status: 'rejected' });
    expect(s.ambassador.history.map((h) => h.type)).toEqual(['ticket_checked', 'rejected']);
    expect(s.ambassador.history[1]?.detail).toEqual({ reason: 'Commande annulée en caisse' });
  });

  it('journée terminée et lue en entier sans la vente : introuvable, à vérifier par l’équipe', async () => {
    const s = await setup([photo({ ticketId: id(7) })]);
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

  it('heure illisible : la veille puis la date imprimée sont lues avant de conclure', async () => {
    const s = await setup([photo({ ticketId: id(7), time: null })]);
    const fake = fakeSource({ '2026-11-23': [[]], [YESTERDAY]: [[]] });
    const deps = { ...s, source: fake.source };
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ notFound: 0 });
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ notFound: 1 });
    expect(fake.calls).toEqual([
      ['2026-11-23', 0],
      [YESTERDAY, 0],
    ]);
  });

  it('journée terminée seulement à 02:00 le lendemain : relue en entier ensuite', async () => {
    const s = await setup([photo({ ticketId: id(7), date: TODAY, time: '12:00' })]);
    const fake = fakeSource({ [TODAY]: [[sale({ jourComptable: TODAY })]] });
    const deps = { ...s, source: fake.source };
    await verifyAmbassadorTickets(deps, NOW);
    // 26/11 à 01:30 Paris : la journée du 25 n'est pas terminée.
    await verifyAmbassadorTickets(deps, new Date('2026-11-26T00:30:00Z'));
    expect(fake.calls).toEqual([
      [TODAY, 0],
      [TODAY, 0],
    ]);
    expect(s.ambassador.entries[0]?.ticketCheck).toBe('pending');
    // 26/11 à 02:00 Paris : une lecture entière suffit à conclure.
    const after = new Date('2026-11-26T01:00:00Z');
    expect(await verifyAmbassadorTickets(deps, after)).toMatchObject({ notFound: 1 });
  });

  it('journée lue avant sa fin puis terminée en cours de lecture : relue depuis la page 0', async () => {
    const s = await setup([photo({ ticketId: id(7), date: TODAY })]);
    const fake = fakeSource({
      [TODAY]: [
        [sale({ jourComptable: TODAY })],
        [sale({ jourComptable: TODAY, ticketId: id(2) })],
      ],
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

  it('ticket de borne scanné (QR) : journée de la participation et la précédente', async () => {
    const s = await setup([photo({ date: null, time: null, totalCents: null })]);
    const fake = fakeSource({ [YESTERDAY]: [[]], [TODAY]: [[sale({ jourComptable: TODAY })]] });
    const deps = { ...s, source: fake.source };
    // Participation créée maintenant (journée comptable du 25) : le 24 d'abord, puis le 25.
    await verifyAmbassadorTickets(deps, NOW);
    expect(await verifyAmbassadorTickets(deps, NOW)).toMatchObject({ verified: 1 });
    expect(fake.calls).toEqual([
      [YESTERDAY, 0],
      [TODAY, 0],
    ]);
  });

  it('la journée la plus ancienne d’abord, une page par passage, toutes enseignes', async () => {
    const s = await setup(
      [
        { ...photo({ ticketId: id(1) }), tenantId: OTHER },
        photo({ ticketId: id(2), date: '2026-11-22' }),
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
    const s = await setup([photo()]);
    const logs: string[] = [];
    const log = (m: string) => {
      logs.push(m);
    };
    const limited = fakeSource({}, { ok: false, reason: 'rate_limited', message: '429' });
    expect(await verifyAmbassadorTickets({ ...s, source: limited.source, log }, NOW)).toMatchObject(
      { fetched: false, verified: 0 },
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
      const s = await setup([photo()], [resto({ splash360Live: variant === 'no-source' })]);
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
    const s = await setup([photo()]);
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
