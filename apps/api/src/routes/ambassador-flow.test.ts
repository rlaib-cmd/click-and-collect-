import { Buffer } from 'node:buffer';
import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import {
  adminAmbassadorEntrySchema,
  adminAmbassadorEntriesSchema,
  ambassadorEntriesSchema,
  ambassadorEntrySchema,
  ambassadorProfileSchema,
  apiErrorSchema,
  loyaltySessionSchema,
  photoCheckResponseSchema,
} from '@splash360/contracts';
import { createMemoryAmbassadorStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { processAmbassadorEntries, type StoryChecker } from '../loyalty/ambassador';
import type { PhotoAnalyzer } from '../loyalty/photo-check';
import { BELLA_ID, NOW, sessionToken, testSetup } from '../test-fixtures';

/** Lot 17 (ADR 0022) : compte mémorisé, analyse de la photo, étapes, délais et historique. */
const programs = new Map<string, LoyaltyProgram>([
  ['S360-DEMO-BELLA', { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 100, rewards: [] }],
]);
const TENANT = { id: BELLA_ID, splash360Id: 'S360-DEMO-BELLA' };
const HOUR = 3600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

/** Analyse simulée : verdict fixé, contexte reçu mémorisé. */
function fakeAnalyzer(verdict: 'accepted' | 'rejected' | 'doubtful') {
  const seen: { category: string; products: readonly string[]; bytes: number }[] = [];
  const analyzer: PhotoAnalyzer = {
    analyze(image, context) {
      seen.push({
        category: context.category,
        products: context.products,
        bytes: image.data.byteLength,
      });
      return Promise.resolve({ verdict, reason: `Verdict ${verdict}`, analyzer: 'IA' });
    },
  };
  return { analyzer, seen };
}

function setup(options: { analyzer?: PhotoAnalyzer; photos?: number } = {}) {
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  const ambassador = createMemoryAmbassadorStore(
    {
      [BELLA_ID]: {
        enabled: true,
        instagramHandle: 'pizzeriabella',
        bonusPoints: 50,
        photoCategory: 'pizzas',
      },
    },
    { splash360Ids: { [BELLA_ID]: 'S360-DEMO-BELLA' } },
  );
  const s = testSetup({
    loyalty,
    loyaltyDemoLogin: true,
    ambassador,
    ...(options.analyzer ? { photoAnalyzer: options.analyzer } : {}),
    rateLimits: { orders: 50, reads: 5000, photos: options.photos ?? 50 },
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
  return loyaltySessionSchema.parse(await res.json());
}
const member = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(64).fill(7)]);

const photoCheck = (s: Setup, token: string, data = JPEG, mediaType = 'image/jpeg') =>
  s.app.request('/v1/tenants/bella/ambassador/photo-check', {
    method: 'POST',
    headers: member(token),
    body: JSON.stringify({ mediaType, data: data.toString('base64') }),
  });
const enter = (s: Setup, token: string, body: Record<string, unknown>) =>
  s.app.request('/v1/tenants/bella/ambassador/entries', {
    method: 'POST',
    headers: member(token),
    body: JSON.stringify({ instagramHandle: 'camille.b', ...body }),
  });
async function staff(email: string) {
  return {
    Authorization: `Bearer ${await sessionToken(email)}`,
    'X-Tenant-Id': BELLA_ID,
    ...json,
  };
}
const action = async (s: Setup, id: string, verb: string, email = 'manager@bella.test') =>
  s.app.request(`/v1/admin/ambassador/entries/${id}/${verb}`, {
    method: 'POST',
    headers: await staff(email),
    body: '{}',
  });
const points = async (s: Setup) =>
  (await s.loyalty.getMember(TENANT, s.ambassador.entries[0]?.memberId ?? ''))?.points ?? 0;

/** Participation avec photo acceptée, puis « Mention reçue » au back-office (à NOW). */
async function mentioned(s: Setup, ticketRef = 'BB3001') {
  const session = await join(s);
  const check = photoCheckResponseSchema.parse(
    await (await photoCheck(s, session.memberToken)).json(),
  );
  const entry = ambassadorEntrySchema.parse(
    await (await enter(s, session.memberToken, { ticketRef, photoCheck: check.token })).json(),
  );
  const res = await action(s, entry.id, 'mention');
  expect(res.status).toBe(200);
  return { session, entry: adminAmbassadorEntrySchema.parse(await res.json()) };
}

describe('ambassadeur complet (lot 17)', () => {
  it('mémorise le compte Instagram du membre, modifiable, et le reprend à la participation', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const url = '/v1/tenants/bella/ambassador/profile';
    const read = async () =>
      ambassadorProfileSchema.parse(
        await (await s.app.request(url, { headers: member(memberToken) })).json(),
      ).instagramHandle;
    expect(await read()).toBeNull();
    expect((await s.app.request(url)).status).toBe(401);
    const put = await s.app.request(url, {
      method: 'PUT',
      headers: member(memberToken),
      body: JSON.stringify({ instagramHandle: '@camille.b' }),
    });
    expect(put.status).toBe(200);
    expect(await read()).toBe('camille.b');
    const bad = await s.app.request(url, {
      method: 'PUT',
      headers: member(memberToken),
      body: JSON.stringify({ instagramHandle: 'pas valide' }),
    });
    expect(bad.status).toBe(400);
    // Une participation avec un autre compte le remplace (dernier compte utilisé).
    await enter(s, memberToken, { ticketRef: 'BB3000', instagramHandle: 'nouveau_compte' });
    expect(await read()).toBe('nouveau_compte');
  });

  it('analyse la photo avec la catégorie et la carte, sans la garder, et signe le verdict', async () => {
    const fake = fakeAnalyzer('accepted');
    const s = setup({ analyzer: fake.analyzer });
    const { memberToken } = await join(s);
    const res = await photoCheck(s, memberToken);
    expect(res.status).toBe(200);
    const body = photoCheckResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ verdict: 'accepted', reason: 'Verdict accepted' });
    expect(fake.seen[0]).toMatchObject({ category: 'pizzas', bytes: JPEG.byteLength });
    expect(fake.seen[0]?.products).toContain('Margherita');

    const entry = await enter(s, memberToken, { ticketRef: 'BB3002', photoCheck: body.token });
    expect(entry.status).toBe(201);
    expect(ambassadorEntrySchema.parse(await entry.json())).toMatchObject({
      stage: 'pending',
      photoVerdict: 'accepted',
      creditDueAt: null,
    });
    expect(s.ambassador.entries[0]?.needsReview).toBe(false);
    expect(s.ambassador.history.map((h) => [h.type, h.actor])).toEqual([
      ['created', 'client'],
      ['photo_checked', 'IA'],
    ]);
  });

  it('refuse une photo sans produit de l’enseigne, et la participation qui la reprend', async () => {
    const s = setup({ analyzer: fakeAnalyzer('rejected').analyzer });
    const { memberToken } = await join(s);
    const body = photoCheckResponseSchema.parse(await (await photoCheck(s, memberToken)).json());
    expect(body.verdict).toBe('rejected');
    expect(body.reason).toBe('On ne voit pas de produit Pizzeria Bella sur ta photo…');
    const entry = await enter(s, memberToken, { ticketRef: 'BB3003', photoCheck: body.token });
    expect(entry.status).toBe(400);
    expect(s.ambassador.entries).toHaveLength(0);
  });

  it('sans clé d’IA, ou sans jeton valable : participation « à vérifier »', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const manual = photoCheckResponseSchema.parse(await (await photoCheck(s, memberToken)).json());
    expect(manual.verdict).toBe('doubtful');
    const ok = await enter(s, memberToken, { ticketRef: 'BB3004', photoCheck: manual.token });
    expect(ambassadorEntrySchema.parse(await ok.json()).stage).toBe('to_review');
    // Jeton falsifié (verdict modifié) : ignoré, la participation reste à vérifier.
    const [prefix, payload, sig] = manual.token.split('.');
    const forged = Buffer.from(
      Buffer.from(payload ?? '', 'base64url')
        .toString()
        .replace('doubtful', 'accepted'),
    ).toString('base64url');
    const res = await enter(s, memberToken, {
      ticketRef: 'BB3005',
      photoCheck: `${prefix}.${forged}.${sig}`,
    });
    expect(ambassadorEntrySchema.parse(await res.json())).toMatchObject({
      stage: 'to_review',
      photoVerdict: null,
    });
    // Jeton d'un autre membre : ignoré aussi.
    const other = await join(s, 'autre@example.fr');
    const res2 = await enter(s, other.memberToken, {
      ticketRef: 'BB3006',
      photoCheck: manual.token,
    });
    expect(ambassadorEntrySchema.parse(await res2.json()).photoVerdict).toBeNull();
  });

  it('contrôle la photo reçue : connexion, format réel, taille, débit', async () => {
    const s = setup({ photos: 3 });
    const { memberToken } = await join(s);
    expect(
      (
        await s.app.request('/v1/tenants/bella/ambassador/photo-check', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ mediaType: 'image/jpeg', data: JPEG.toString('base64') }),
        })
      ).status,
    ).toBe(401);
    // Pas une image (en-tête PDF) malgré le type annoncé.
    const pdf = await photoCheck(s, memberToken, Buffer.from('%PDF-1.7 bonjour'));
    expect(pdf.status).toBe(400);
    expect(apiErrorSchema.parse(await pdf.json()).error.message).toContain('JPEG, PNG ou WebP');
    expect((await photoCheck(s, memberToken)).status).toBe(200);
    // Quatrième analyse dans la minute : refusée (plafond de 3 réglé pour le test).
    expect((await photoCheck(s, memberToken)).status).toBe(429);
  });

  it('refuse une photo de plus de 4 Mo', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const big = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
    big.set([0xff, 0xd8, 0xff], 0);
    expect((await photoCheck(s, memberToken, big)).status).toBe(413);
  });

  it('mention reçue : contrôle à +20 h, crédit à +24 h, une seule fois, tout journalisé', async () => {
    const s = setup({ analyzer: fakeAnalyzer('accepted').analyzer });
    const { session, entry } = await mentioned(s);
    const before = await points(s);
    expect(entry).toMatchObject({
      stage: 'mention_received',
      mentionBy: 'manager@bella.test',
      mentionReceivedAt: NOW.toISOString(),
      checkDueAt: at(20).toISOString(),
      creditDueAt: at(24).toISOString(),
    });
    expect((await action(s, entry.id, 'mention')).status).toBe(409);

    // Le client lit la date prévue du crédit.
    const mine = ambassadorEntriesSchema.parse(
      await (
        await s.app.request('/v1/tenants/bella/ambassador/entries', {
          headers: member(session.memberToken),
        })
      ).json(),
    );
    expect(mine.entries[0]).toMatchObject({
      stage: 'mention_received',
      creditDueAt: at(24).toISOString(),
    });

    const deps = { ambassador: s.ambassador, loyalty: s.loyalty };
    expect(await processAmbassadorEntries(deps, at(19))).toEqual({
      checked: 0,
      credited: 0,
      rejected: 0,
    });
    expect(await processAmbassadorEntries(deps, at(20))).toMatchObject({ checked: 1 });
    expect(await points(s)).toBe(before);
    // Deux passages simultanés à l'échéance : un seul crédit.
    const runs = await Promise.all([
      processAmbassadorEntries(deps, at(24)),
      processAmbassadorEntries(deps, at(24)),
    ]);
    expect(runs.reduce((sum, r) => sum + r.credited, 0)).toBe(1);
    expect(await points(s)).toBe(before + 50);
    expect(await processAmbassadorEntries(deps, at(48))).toMatchObject({ credited: 0 });
    // Le refus n'est plus possible après le crédit.
    expect((await action(s, entry.id, 'reject')).status).toBe(409);

    const list = adminAmbassadorEntriesSchema.parse(
      await (
        await s.app.request('/v1/admin/ambassador/entries', {
          headers: await staff('manager@bella.test'),
        })
      ).json(),
    );
    expect(list.entries[0]?.stage).toBe('credited');
    expect(list.entries[0]?.events.map((e) => [e.type, e.actor])).toEqual([
      ['created', 'client'],
      ['photo_checked', 'IA'],
      ['mention_received', 'manager@bella.test'],
      ['story_checked', 'système'],
      ['credited', 'système'],
    ]);
    expect(list.entries[0]?.events[3]?.detail).toEqual({ result: 'online' });
  });

  it('« Refuser » avant le crédit : aucun point, ni par la tâche ni ensuite', async () => {
    const s = setup({ analyzer: fakeAnalyzer('accepted').analyzer });
    const { entry } = await mentioned(s);
    const before = await points(s);
    const res = await s.app.request(`/v1/admin/ambassador/entries/${entry.id}/reject`, {
      method: 'POST',
      headers: await staff('manager@bella.test'),
      body: JSON.stringify({ reason: 'Story sans mention' }),
    });
    expect(res.status).toBe(200);
    const view = adminAmbassadorEntrySchema.parse(await res.json());
    expect(view.stage).toBe('rejected');
    expect(view.events.at(-1)).toMatchObject({
      type: 'rejected',
      actor: 'manager@bella.test',
      detail: { reason: 'Story sans mention' },
    });
    const deps = { ambassador: s.ambassador, loyalty: s.loyalty };
    expect(await processAmbassadorEntries(deps, at(30))).toEqual({
      checked: 0,
      credited: 0,
      rejected: 0,
    });
    expect(await points(s)).toBe(before);
  });

  it('story retirée au contrôle : refus automatique', async () => {
    const s = setup({ analyzer: fakeAnalyzer('accepted').analyzer });
    await mentioned(s);
    const removed: StoryChecker = { check: () => Promise.resolve('removed') };
    const deps = { ambassador: s.ambassador, loyalty: s.loyalty, storyChecker: removed };
    expect(await processAmbassadorEntries(deps, at(25))).toEqual({
      checked: 1,
      credited: 0,
      rejected: 1,
    });
    expect(s.ambassador.entries[0]?.status).toBe('rejected');
  });

  it('« Valider maintenant » : propriétaire seulement, crédit immédiat et unique', async () => {
    const s = setup({ analyzer: fakeAnalyzer('accepted').analyzer });
    const { entry } = await mentioned(s);
    const before = await points(s);
    expect((await action(s, entry.id, 'validate', 'manager@bella.test')).status).toBe(403);
    const res = await action(s, entry.id, 'validate', 'gerant@bella.test');
    expect(res.status).toBe(200);
    const view = adminAmbassadorEntrySchema.parse(await res.json());
    expect(view.stage).toBe('credited');
    expect(view.events.at(-1)).toMatchObject({ type: 'credited', actor: 'gerant@bella.test' });
    expect(await points(s)).toBe(before + 50);
    expect((await action(s, entry.id, 'validate', 'gerant@bella.test')).status).toBe(409);
    expect(await points(s)).toBe(before + 50);
  });

  it('règle les délais et la catégorie au back-office, contrôle avant crédit', async () => {
    const s = setup();
    const headers = await staff('gerant@bella.test');
    const put = (body: unknown) =>
      s.app.request('/v1/admin/ambassador', { method: 'PUT', headers, body: JSON.stringify(body) });
    const base = { enabled: true, instagramHandle: 'pizzeriabella', bonusPoints: 40 };
    expect((await put({ ...base, checkAfterHours: 30, creditAfterHours: 24 })).status).toBe(400);
    expect(
      (await put({ ...base, checkAfterHours: 10, creditAfterHours: 12, photoCategory: 'pizza' }))
        .status,
    ).toBe(204);
    expect(await s.ambassador.getSettings(BELLA_ID)).toMatchObject({
      bonusPoints: 40,
      checkAfterHours: 10,
      creditAfterHours: 12,
      photoCategory: 'pizza',
    });
    // Sans délais : les valeurs actuelles sont conservées.
    expect((await put(base)).status).toBe(204);
    expect(await s.ambassador.getSettings(BELLA_ID)).toMatchObject({ checkAfterHours: 10 });
  });
});
