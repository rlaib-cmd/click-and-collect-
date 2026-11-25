import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import {
  adminAmbassadorEntriesSchema,
  ambassadorConfigSchema,
  ambassadorEntriesSchema,
  ambassadorEntrySchema,
  apiErrorSchema,
  loyaltySessionSchema,
} from '@splash360/contracts';
import { createMemoryAmbassadorStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { confirmAmbassadorEntry, rejectAmbassadorEntry } from '../loyalty/ambassador';
import { BELLA_ID, GREEN_ID, sessionToken, testSetup } from '../test-fixtures';

/** Lot 15 (ADR 0019) : participation « Ambassadeur » enregistrée en attente, points à la confirmation. */
const programs = new Map<string, LoyaltyProgram>([
  ['S360-DEMO-BELLA', { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 100, rewards: [] }],
]);

function setup() {
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  const ambassador = createMemoryAmbassadorStore({
    [BELLA_ID]: { enabled: true, instagramHandle: 'pizzeriabella', bonusPoints: 50 },
  });
  return { ...testSetup({ loyalty, loyaltyDemoLogin: true, ambassador }), loyalty, ambassador };
}

const json = { 'Content-Type': 'application/json' };
async function join(s: ReturnType<typeof setup>, email = 'camille@example.fr') {
  const res = await s.app.request('/v1/tenants/bella/loyalty/join', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: 'Camille', email, phone: null, acceptedTerms: true }),
  });
  return loyaltySessionSchema.parse(await res.json());
}
const enter = (s: ReturnType<typeof setup>, token: string | null, body: unknown) =>
  s.app.request('/v1/tenants/bella/ambassador/entries', {
    method: 'POST',
    headers: { ...json, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe('ambassadeur', () => {
  it('publie le compte à taguer sans « @ » et le bonus, seulement si la fonction est active', async () => {
    const s = setup();
    const bella = ambassadorConfigSchema.parse(
      await (await s.app.request('/v1/tenants/bella/ambassador')).json(),
    );
    expect(bella).toEqual({ enabled: true, instagramHandle: 'pizzeriabella', bonusPoints: 50 });
    const green = ambassadorConfigSchema.parse(
      await (await s.app.request('/v1/tenants/greenbowl/ambassador')).json(),
    );
    expect(green).toEqual({ enabled: false });
  });

  it('enregistre une participation en attente, sans créditer de points, une fois par ticket', async () => {
    const s = setup();
    const session = await join(s);
    const before = session.member.points;

    const res = await enter(s, session.memberToken, {
      ticketRef: 'bb 1042',
      instagramHandle: '@camille.burger',
    });
    expect(res.status).toBe(201);
    expect(ambassadorEntrySchema.parse(await res.json())).toMatchObject({
      status: 'pending',
      ticketRef: 'BB1042',
      bonusPoints: 50,
    });
    expect(s.ambassador.entries[0]?.instagramHandle).toBe('camille.burger');

    // Même ticket, même par un autre membre : refusé.
    const other = await join(s, 'autre@example.fr');
    const again = await enter(s, other.memberToken, { ticketRef: 'BB1042', instagramHandle: 'x' });
    expect(again.status).toBe(409);
    expect(apiErrorSchema.parse(await again.json()).error.code).toBe('conflict');

    const me = await s.app.request('/v1/tenants/bella/loyalty/me', {
      headers: { Authorization: `Bearer ${session.memberToken}` },
    });
    expect(loyaltySessionSchema.shape.member.parse(await me.json()).points).toBe(before);

    const mine = ambassadorEntriesSchema.parse(
      await (
        await s.app.request('/v1/tenants/bella/ambassador/entries', {
          headers: { Authorization: `Bearer ${session.memberToken}` },
        })
      ).json(),
    );
    expect(mine.entries).toHaveLength(1);
  });

  it('déduit lui-même le ticket du QR scanné, sans croire le numéro envoyé par l’app', async () => {
    const s = setup();
    const session = await join(s);
    const res = await enter(s, session.memberToken, {
      ticketRef: 'FAUX-999', // ignoré : le serveur relit le QR
      ticketQr: 'https://example.test/t?ticket=bb-2042',
      instagramHandle: 'camille',
    });
    expect(res.status).toBe(201);
    expect(ambassadorEntrySchema.parse(await res.json()).ticketRef).toBe('BB-2042');
    expect(s.ambassador.entries[0]).toMatchObject({
      ticketRef: 'BB-2042',
      ticketQr: 'https://example.test/t?ticket=bb-2042',
    });
    // Le même ticket, saisi à la main ensuite : déjà utilisé.
    const manual = await enter(s, session.memberToken, {
      ticketRef: 'BB-2042',
      instagramHandle: 'camille',
    });
    expect(manual.status).toBe(409);
    // Le back-office voit qu'il s'agit d'un scan.
    expect(s.ambassador.entries.map((e) => e.ticketQr !== null)).toEqual([true]);
  });

  it('exige un membre connecté et une saisie valide', async () => {
    const s = setup();
    expect((await enter(s, null, { ticketRef: 'BB1', instagramHandle: 'x' })).status).toBe(401);
    const session = await join(s);
    expect(
      (await enter(s, session.memberToken, { ticketRef: '<>', instagramHandle: 'x' })).status,
    ).toBe(400);
    expect(
      (await enter(s, session.memberToken, { ticketRef: 'BB1042', instagramHandle: 'a b' })).status,
    ).toBe(400);
  });

  it('crédite le bonus une seule fois à la confirmation, jamais au refus', async () => {
    const s = setup();
    const session = await join(s);
    const entry = ambassadorEntrySchema.parse(
      await (
        await enter(s, session.memberToken, { ticketRef: 'BB2001', instagramHandle: 'moi' })
      ).json(),
    );
    const tenant = { id: BELLA_ID, splash360Id: 'S360-DEMO-BELLA' };
    const deps = { ambassador: s.ambassador, loyalty: s.loyalty };
    const at = new Date();
    expect((await confirmAmbassadorEntry(deps, tenant, entry.id, at)).ok).toBe(true);
    expect(await confirmAmbassadorEntry(deps, tenant, entry.id, at)).toEqual({
      ok: false,
      error: 'not_pending',
    });
    const memberId = s.ambassador.entries[0]?.memberId ?? '';
    expect((await s.loyalty.getMember(tenant, memberId))?.points).toBe(session.member.points + 50);

    const second = ambassadorEntrySchema.parse(
      await (
        await enter(s, session.memberToken, { ticketRef: 'BB2002', instagramHandle: 'moi' })
      ).json(),
    );
    expect(await rejectAmbassadorEntry(s.ambassador, BELLA_ID, second.id, at)).toBe(true);
    expect((await confirmAmbassadorEntry(deps, tenant, second.id, at)).ok).toBe(false);
    expect((await s.loyalty.getMember(tenant, memberId))?.points).toBe(session.member.points + 50);
  });

  it('se règle au back-office : compte sans « @ » obligatoire pour activer', async () => {
    const s = setup();
    const headers = {
      Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
      'X-Tenant-Id': BELLA_ID,
      ...json,
    };
    const bad = await s.app.request('/v1/admin/ambassador', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true, instagramHandle: null, bonusPoints: 50 }),
    });
    expect(bad.status).toBe(400);
    const ok = await s.app.request('/v1/admin/ambassador', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true, instagramHandle: '@bella.paris', bonusPoints: 30 }),
    });
    expect(ok.status).toBe(204);
    expect(await s.ambassador.getSettings(BELLA_ID)).toEqual({
      enabled: true,
      instagramHandle: 'bella.paris',
      bonusPoints: 30,
    });
    const list = adminAmbassadorEntriesSchema.parse(
      await (await s.app.request('/v1/admin/ambassador/entries', { headers })).json(),
    );
    expect(list.entries).toEqual([]);
    expect(await s.ambassador.getSettings(GREEN_ID)).toMatchObject({ enabled: false });
  });
});
