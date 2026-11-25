import { Buffer } from 'node:buffer';
import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import {
  adminAmbassadorEntriesSchema,
  ambassadorEntriesSchema,
  ambassadorEntrySchema,
  apiErrorSchema,
  loyaltySessionSchema,
  ticketPhotoResponseSchema,
} from '@splash360/contracts';
import {
  createMemoryAmbassadorStore,
  createMemoryPosSalesStore,
  createMemoryRestaurantStore,
} from '@splash360/db';
import { describe, expect, it } from 'vitest';
import type { SalesFetchResult, SalesSource } from '../loyalty/ticket-check';
import type { TicketReader, TicketReading } from '../loyalty/ticket-read';
import { BELLA_ID, BELLA_RESTO, NOW, restaurants, sessionToken, testSetup } from '../test-fixtures';

/** Lot 20 (ADR 0025) : « Achat vérifié », ticket de caisse photographié et lu par l'IA. */
const programs = new Map<string, LoyaltyProgram>([
  ['S360-DEMO-BELLA', { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 100, rewards: [] }],
]);

/** Identifiants de vente factices (aucun identifiant réel dans le dépôt). */
const ID = '6f1c1c2e-0000-4000-8000-00000000000b';
const ID2 = '6f1c1c2e-0000-4000-8000-00000000000c';

/** Lecture simulée : résultat fixé, taille de l'image reçue mémorisée. */
function fakeReader(result: Partial<TicketReading> = {}) {
  const seen: number[] = [];
  const reader: TicketReader = {
    read(image) {
      seen.push(image.data.byteLength);
      return Promise.resolve({
        readable: true,
        ticketId: ID,
        date: '2026-11-24',
        time: '12:41',
        totalCents: 1230,
        analyzer: 'IA',
        ...result,
      });
    },
  };
  return { reader, seen };
}

function setup(reader?: TicketReader, extra: { salesSource?: SalesSource; now?: () => Date } = {}) {
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  const ambassador = createMemoryAmbassadorStore(
    { [BELLA_ID]: { enabled: true, instagramHandle: 'pizzeriabella', bonusPoints: 50 } },
    { splash360Ids: { [BELLA_ID]: 'S360-DEMO-BELLA' } },
  );
  const s = testSetup({
    loyalty,
    loyaltyDemoLogin: true,
    ambassador,
    ...(reader ? { ticketReader: reader } : {}),
    rateLimits: { orders: 50, reads: 5000, photos: 50 },
    // Bella branchée sur Splash360 (restaurant 164) : ses ventes servent au rapprochement.
    restaurants: createMemoryRestaurantStore(
      restaurants.map((r) =>
        r.id === BELLA_RESTO ? { ...r, splash360Id: '164', splash360Live: true } : r,
      ),
    ),
    posSales: createMemoryPosSalesStore(),
    ...(extra.salesSource ? { salesSource: extra.salesSource } : {}),
    ...(extra.now ? { now: extra.now } : {}),
  });
  return { ...s, loyalty, ambassador };
}
type Setup = ReturnType<typeof setup>;

const json = { 'Content-Type': 'application/json' };
async function join(s: Setup, email = 'camille@example.fr') {
  const res = await s.app.request('/v1/tenants/bella/loyalty/join', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: 'Camille', email, phone: null, acceptedTerms: true }),
  });
  return loyaltySessionSchema.parse(await res.json()).memberToken;
}
const member = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(64).fill(7)]);

const ticketPhoto = (s: Setup, token: string, data = JPEG) =>
  s.app.request('/v1/tenants/bella/ambassador/ticket-photo', {
    method: 'POST',
    headers: member(token),
    body: JSON.stringify({ mediaType: 'image/jpeg', data: data.toString('base64') }),
  });
const enter = (s: Setup, token: string, body: Record<string, unknown>) =>
  s.app.request('/v1/tenants/bella/ambassador/entries', {
    method: 'POST',
    headers: member(token),
    body: JSON.stringify({ instagramHandle: 'camille.b', ...body }),
  });
const errorOf = async (res: Response) => apiErrorSchema.parse(await res.json()).error.message;

describe('achat vérifié : lecture du ticket photographié (lot 20)', () => {
  it('lit le ticket sans le garder et signe les données lues', async () => {
    const fake = fakeReader();
    const s = setup(fake.reader);
    const token = await join(s);
    const res = await ticketPhoto(s, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = ticketPhotoResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      readable: true,
      ticketId: ID,
      date: '2026-11-24',
      time: '12:41',
      totalCents: 1230,
    });
    expect(body.token).toMatch(/^r1\./);
    expect(fake.seen).toEqual([JPEG.byteLength]);
  });

  it('sans clé d’IA ou ticket illisible : pas de jeton, le client tape le numéro', async () => {
    for (const s of [setup(), setup(fakeReader({ readable: false }).reader)]) {
      const token = await join(s);
      const body = ticketPhotoResponseSchema.parse(await (await ticketPhoto(s, token)).json());
      expect(body).toEqual({
        readable: false,
        ticketId: null,
        date: null,
        time: null,
        totalCents: null,
        token: null,
      });
    }
  });

  it('refuse un ticket du futur ou de plus de 7 jours', async () => {
    const future = setup(fakeReader({ date: '2026-11-25' }).reader);
    const res = await ticketPhoto(future, await join(future));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain('futur');
    const old = setup(fakeReader({ date: '2026-11-16' }).reader);
    const res2 = await ticketPhoto(old, await join(old));
    expect(res2.status).toBe(400);
    expect(await errorOf(res2)).toContain('plus de 7 jours');
    const limit = setup(fakeReader({ date: '2026-11-17' }).reader);
    expect((await ticketPhoto(limit, await join(limit))).status).toBe(200);
  });

  it('contrôle la photo reçue : connexion et format réel', async () => {
    const s = setup(fakeReader().reader);
    const res = await s.app.request('/v1/tenants/bella/ambassador/ticket-photo', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ mediaType: 'image/jpeg', data: JPEG.toString('base64') }),
    });
    expect(res.status).toBe(401);
    const token = await join(s);
    expect((await ticketPhoto(s, token, Buffer.from('%PDF-1.7 bonjour'))).status).toBe(400);
  });
});

describe('achat vérifié : participation avec le ticket photographié (lot 20)', () => {
  async function photographed(s: Setup, token: string) {
    return ticketPhotoResponseSchema.parse(await (await ticketPhoto(s, token)).json()).token ?? '';
  }

  it('déduit la référence du ticket, la met « à vérifier » et journalise la lecture', async () => {
    const s = setup(fakeReader().reader);
    const token = await join(s);
    const res = await enter(s, token, { ticketPhoto: await photographed(s, token) });
    expect(res.status).toBe(201);
    expect(ambassadorEntrySchema.parse(await res.json())).toMatchObject({
      ticketRef: ID.toUpperCase(),
      ticketCheck: 'pending',
    });
    expect(s.ambassador.entries[0]).toMatchObject({
      ticketQr: null,
      ticketId: ID,
      ticketDate: '2026-11-24',
      ticketTime: '12:41',
      ticketTotalCents: 1230,
    });
    expect(s.ambassador.history.map((h) => [h.type, h.actor])).toEqual([
      ['created', 'client'],
      ['ticket_read', 'IA'],
      ['photo_checked', 'système'],
    ]);
    expect(s.ambassador.history[0]?.detail).toMatchObject({ ticket: 'photographié' });

    // Même ticket, même un autre membre : une seule participation par achat.
    const other = await join(s, 'autre@example.fr');
    const again = await enter(s, other, { ticketPhoto: await photographed(s, other) });
    expect(again.status).toBe(409);

    // Le numéro saisi en plus est ignoré : la référence vient des données signées.
    const s2 = setup(fakeReader({ ticketId: ID2 }).reader);
    const t2 = await join(s2);
    const typed = await enter(s2, t2, {
      ticketRef: 'AUTRE-1',
      ticketPhoto: await photographed(s2, t2),
    });
    expect(ambassadorEntrySchema.parse(await typed.json()).ticketRef).toBe(ID2.toUpperCase());

    // Liste du membre et back-office : état de la vérification et données lues.
    const mine = ambassadorEntriesSchema.parse(
      await (
        await s.app.request('/v1/tenants/bella/ambassador/entries', { headers: member(token) })
      ).json(),
    );
    expect(mine.entries[0]?.ticketCheck).toBe('pending');
    const admin = await s.app.request('/v1/admin/ambassador/entries', {
      headers: {
        Authorization: `Bearer ${await sessionToken('manager@bella.test')}`,
        'X-Tenant-Id': BELLA_ID,
      },
    });
    expect(adminAmbassadorEntriesSchema.parse(await admin.json()).entries[0]).toMatchObject({
      ticketCheck: 'pending',
      ticketId: ID,
      ticketDate: '2026-11-24',
      ticketTime: '12:41',
      ticketTotalCents: 1230,
      scanned: false,
    });
  });

  it('refuse un jeton falsifié, d’un autre membre, ou combiné à un QR', async () => {
    const s = setup(fakeReader().reader);
    const token = await join(s);
    const signed = await photographed(s, token);
    const [prefix, payload, sig] = signed.split('.');
    const forged = Buffer.from(
      Buffer.from(payload ?? '', 'base64url')
        .toString()
        .replace('1230', '9990'),
    ).toString('base64url');
    const bad = await enter(s, token, { ticketPhoto: `${prefix}.${forged}.${sig}` });
    expect(bad.status).toBe(400);
    expect(await errorOf(bad)).toContain('Photo du ticket');
    const other = await join(s, 'autre@example.fr');
    expect((await enter(s, other, { ticketPhoto: signed })).status).toBe(400);
    const both = await enter(s, token, {
      ticketRef: 'BB1',
      ticketQr: 'https://ticket.test/?t=BB1',
      ticketPhoto: signed,
    });
    expect(both.status).toBe(400);
    expect((await enter(s, token, {})).status).toBe(400);
    expect(s.ambassador.entries).toHaveLength(0);
  });

  it('ticket scanné ou saisi : inchangé, « non vérifié »', async () => {
    const s = setup(fakeReader().reader);
    const token = await join(s);
    const typed = await enter(s, token, { ticketRef: 'BB4001' });
    expect(ambassadorEntrySchema.parse(await typed.json())).toMatchObject({
      ticketRef: 'BB4001',
      ticketCheck: 'unverified',
    });
    const scanned = await enter(s, token, {
      ticketRef: 'BB4002',
      ticketQr: 'https://ticket.test/?ticket=BB4002',
    });
    expect(ambassadorEntrySchema.parse(await scanned.json())).toMatchObject({
      ticketRef: 'BB4002',
      ticketCheck: 'unverified',
    });
    // QR de borne portant le ticket_id : vérifié comme une photo, sans date ni total.
    const kiosk = await enter(s, token, {
      ticketRef: 'BB4003',
      ticketQr: `https://borne.test/t?id=${ID2.toUpperCase()}`,
    });
    expect(ambassadorEntrySchema.parse(await kiosk.json())).toMatchObject({
      ticketRef: ID2.toUpperCase(),
      ticketCheck: 'pending',
    });
    expect(s.ambassador.entries.at(-1)).toMatchObject({
      ticketId: ID2,
      ticketDate: null,
      ticketTotalCents: null,
    });
    expect(s.ambassador.history.filter((h) => h.type === 'ticket_read').at(-1)).toMatchObject({
      actor: 'client',
      detail: { ticketId: ID2, source: 'QR' },
    });
  });

  it('ticket de plus de 7 jours selon la journée comptable : coupure à 02:00', async () => {
    // Maintenant : 24/11 10 h à Paris. Ticket du 17/11 à 01:30 : journée du 16, refusée.
    const night = setup(fakeReader({ date: '2026-11-17', time: '01:30' }).reader);
    expect((await ticketPhoto(night, await join(night))).status).toBe(400);
    // Heure illisible : le 17 reste possible.
    const unknown = setup(fakeReader({ date: '2026-11-17', time: null }).reader);
    expect((await ticketPhoto(unknown, await join(unknown))).status).toBe(200);
  });
});

describe('achat vérifié : crédit des points (lot 20)', () => {
  const HOUR = 3600_000;
  /** Export simulé : une vente du 24/11 (identifiant, statut), ou une réponse imposée. */
  function source(ticketId: string | null, status: 'confirmed' | 'deleted' = 'confirmed') {
    let forced: SalesFetchResult | null = null;
    const calls: number[] = [];
    const salesSource: SalesSource = {
      fetchPage(_jour, page) {
        calls.push(page);
        if (forced) return Promise.resolve(forced);
        const sales = ticketId
          ? [
              {
                ticketId,
                restaurantId: '164',
                jourComptable: '2026-11-24',
                status,
                totalCents: 1230,
              },
            ]
          : [];
        return Promise.resolve({ ok: true, page: { sales, hasNextPage: false, skipped: 0 } });
      },
    };
    return {
      salesSource,
      calls,
      force(r: SalesFetchResult | null) {
        forced = r;
      },
    };
  }

  /** Ticket photographié le 24/11, puis « Mention reçue » : contrôle à +20 h, crédit à +24 h. */
  async function participate(src: ReturnType<typeof source>) {
    let clock = NOW;
    const s = setup(fakeReader().reader, { salesSource: src.salesSource, now: () => clock });
    const token = await join(s);
    const photo = ticketPhotoResponseSchema.parse(await (await ticketPhoto(s, token)).json());
    const res = await enter(s, token, { ticketPhoto: photo.token });
    const id = ambassadorEntrySchema.parse(await res.json()).id;
    const mention = await s.app.request(`/v1/admin/ambassador/entries/${id}/mention`, {
      method: 'POST',
      headers: {
        ...json,
        Authorization: `Bearer ${await sessionToken('manager@bella.test')}`,
        'X-Tenant-Id': BELLA_ID,
      },
      body: '{}',
    });
    expect(mention.status).toBe(200);
    const memberId = s.ambassador.entries[0]?.memberId ?? '';
    const points = async () =>
      (await s.loyalty.getMember({ id: BELLA_ID, splash360Id: 'S360-DEMO-BELLA' }, memberId))
        ?.points ?? 0;
    const before = await points();
    return {
      s,
      gained: async () => (await points()) - before,
      at: (hours: number) => {
        clock = new Date(NOW.getTime() + hours * HOUR);
      },
    };
  }

  it('achat vérifié : points crédités à l’échéance', async () => {
    const src = source(ID);
    const p = await participate(src);
    p.at(25);
    const r = await p.s.app.runAmbassador();
    expect(r.tickets).toMatchObject({ verified: 1, fetched: true });
    expect(r.credited).toBe(1);
    expect(await p.gained()).toBe(50);
    expect(p.s.ambassador.entries[0]).toMatchObject({
      ticketCheck: 'verified',
      status: 'confirmed',
    });
  });

  it('jamais de crédit automatique tant que le ticket est à vérifier ou introuvable', async () => {
    const src = source(null);
    src.force({ ok: false, reason: 'rate_limited', message: '429' });
    const p = await participate(src);
    p.at(25);
    const r1 = await p.s.app.runAmbassador();
    expect(r1).toMatchObject({ checked: 1, credited: 0 });
    expect(p.s.ambassador.entries[0]?.ticketCheck).toBe('pending');
    p.at(30);
    expect((await p.s.app.runAmbassador()).credited).toBe(0);
    // Journée lue en entier, la commande n'y est pas : introuvable, l'équipe tranche.
    src.force(null);
    const r3 = await p.s.app.runAmbassador();
    expect(r3.tickets.notFound).toBe(1);
    expect(r3.credited).toBe(0);
    p.at(48);
    expect((await p.s.app.runAmbassador()).credited).toBe(0);
    expect(await p.gained()).toBe(0);
    expect(p.s.ambassador.entries[0]).toMatchObject({
      ticketCheck: 'not_found',
      needsReview: true,
      status: 'pending',
    });
  });

  it('commande annulée en caisse : participation refusée, aucun point', async () => {
    const p = await participate(source(ID, 'deleted'));
    p.at(25);
    const r = await p.s.app.runAmbassador();
    expect(r.tickets.unpaid).toBe(1);
    expect(r.credited).toBe(0);
    expect(await p.gained()).toBe(0);
    expect(p.s.ambassador.entries[0]).toMatchObject({ ticketCheck: 'unpaid', status: 'rejected' });
  });
});
