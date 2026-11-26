import { afterAll, describe, expect, it } from 'vitest';
import { createPostgresAmbassadorStore, ERASED_MEMBER } from './ambassador';
import { createSql } from './client';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BILLS = '00000000-0000-4000-8000-000000000005';
const BELLA = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!url)('AmbassadorStore Postgres (lots 15 et 17)', () => {
  const sql = createSql(url ?? '', { max: 2 });
  const store = createPostgresAmbassadorStore(sql);
  const run = `${Date.now()}`.slice(-8);
  afterAll(async () => {
    await sql`delete from public.ambassador_entries where ticket_ref like ${`T${run}%`}`;
    await sql`delete from public.ambassador_profiles where member_id like ${`membre-${run}%`}`;
    await sql.end();
  });

  it('lit les réglages de Bills Burger et ceux, par défaut, d’une enseigne sans réglage', async () => {
    expect(await store.getSettings(BILLS)).toEqual({
      enabled: true,
      instagramHandle: 'billsburgerfr',
      bonusPoints: 50,
      checkAfterHours: 20,
      creditAfterHours: 24,
      photoCategory: 'burgers',
    });
    expect((await store.getSettings(BELLA)).enabled).toBe(false);
  });

  it('accepte une participation par ticket, puis ne la décide qu’une fois', async () => {
    const first = await store.createEntry(
      {
        tenantId: BILLS,
        memberId: 'membre-test',
        ticketRef: `T${run}A`,
        instagramHandle: 'client.test',
        bonusPoints: 50,
      },
      [],
    );
    expect(first.ok).toBe(true);
    const again = await store.createEntry(
      {
        tenantId: BILLS,
        memberId: 'autre-membre',
        ticketRef: `T${run}A`,
        instagramHandle: 'autre',
        bonusPoints: 50,
      },
      [],
    );
    expect(again).toEqual({ ok: false, error: 'ticket_already_used' });
    if (!first.ok) throw new Error('participation non créée');
    expect(first.entry.ticketQr).toBeNull();
    const scanned = await store.createEntry(
      {
        tenantId: BILLS,
        memberId: 'membre-test',
        ticketRef: `T${run}Q`,
        ticketQr: `https://example.test/t?ticket=T${run}Q`,
        instagramHandle: 'client.test',
        bonusPoints: 50,
      },
      [],
    );
    expect(scanned.ok && scanned.entry.ticketQr).toBe(`https://example.test/t?ticket=T${run}Q`);

    const at = new Date();
    const [a, b] = await Promise.all([
      store.decide(BILLS, first.entry.id, 'confirmed', at),
      store.decide(BILLS, first.entry.id, 'confirmed', at),
    ]);
    // Deux décisions simultanées : une seule passe (un seul crédit de points).
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await store.decide(BELLA, first.entry.id, 'rejected', at)).toBeNull();
    const mine = await store.memberEntries(BILLS, 'membre-test');
    expect(mine.find((e) => e.id === first.entry.id)?.status).toBe('confirmed');
  });

  it('mémorise le compte Instagram du membre et le remplace à la modification', async () => {
    const member = `membre-${run}`;
    expect(await store.getProfile(BILLS, member)).toBeNull();
    await store.saveProfile(BILLS, member, 'premier.compte');
    await store.saveProfile(BILLS, member, 'nouveau_compte');
    expect(await store.getProfile(BILLS, member)).toBe('nouveau_compte');
    expect(await store.getProfile(BELLA, member)).toBeNull();
  });

  it('suit les étapes d’une participation et en journalise chaque événement', async () => {
    const created = await store.createEntry(
      {
        tenantId: BILLS,
        memberId: 'membre-test',
        ticketRef: `T${run}F`,
        instagramHandle: 'client.test',
        bonusPoints: 50,
        photoVerdict: 'doubtful',
        photoReason: 'Photo floue',
        needsReview: true,
      },
      [
        { type: 'created', actor: 'client', detail: { ticketRef: `T${run}F` } },
        { type: 'photo_checked', actor: 'IA', detail: { verdict: 'doubtful' } },
      ],
    );
    if (!created.ok) throw new Error('participation non créée');
    expect(created.entry).toMatchObject({ photoVerdict: 'doubtful', needsReview: true });
    const id = created.entry.id;
    const at = new Date();
    const later = new Date(at.getTime() + 25 * 3600_000);
    const mention = {
      at,
      by: 'equipe@test',
      checkDueAt: new Date(at.getTime() + 20 * 3600_000),
      creditDueAt: new Date(at.getTime() + 24 * 3600_000),
    };
    const [m1, m2] = await Promise.all([
      store.markMention(BILLS, id, mention),
      store.markMention(BILLS, id, mention),
    ]);
    expect([m1, m2].filter(Boolean)).toHaveLength(1);
    expect(await store.markMention(BELLA, id, mention)).toBeNull();

    const due = await store.dueEntries(later, 500);
    expect(due.find((e) => e.id === id)?.splash360Id).toBeTruthy();
    const check = { at: later, result: 'online' as const, actor: 'système' };
    expect(await store.recordCheck(BILLS, id, check)).toMatchObject({ checkResult: 'online' });
    expect(await store.recordCheck(BILLS, id, check)).toBeNull();
    const decided = await store.decide(BILLS, id, 'confirmed', later, {
      type: 'credited',
      actor: 'système',
      detail: { points: 50 },
    });
    expect(decided?.status).toBe('confirmed');
    expect((await store.dueEntries(later, 500)).some((e) => e.id === id)).toBe(false);

    const events = await store.events(BILLS, [id]);
    expect(events.map((e) => e.type)).toEqual([
      'created',
      'photo_checked',
      'mention_received',
      'story_checked',
      'credited',
    ]);
    expect(events[2]).toMatchObject({ actor: 'equipe@test' });
    expect(events[4]?.detail).toEqual({ points: 50 });
    expect(await store.events(BELLA, [id])).toEqual([]);
  });
  it('enregistre un ticket photographié « à vérifier » et ne le crédite pas avant le rapprochement', async () => {
    const ids = { P1: 'a1', P2: 'a2', P3: 'a3' } as const;
    const ticket = (suffix: keyof typeof ids) => ({
      ticketId: `6f1c1c2e-0000-4000-8000-${run}00${ids[suffix]}`,
      date: '2026-11-24',
      time: '12:41',
      totalCents: 1230,
    });
    const create = (suffix: keyof typeof ids) =>
      store.createEntry(
        {
          tenantId: BILLS,
          memberId: 'membre-test',
          ticketRef: `T${run}${suffix}`,
          instagramHandle: 'client.test',
          bonusPoints: 50,
          ticket: ticket(suffix),
        },
        [{ type: 'ticket_read', actor: 'IA', detail: { ticketId: ticket(suffix).ticketId } }],
      );
    const a = await create('P1');
    const b = await create('P2');
    const c = await create('P3');
    if (!a.ok || !b.ok || !c.ok) throw new Error('participations non créées');
    expect(a.entry).toMatchObject({
      ticketCheck: 'pending',
      ticketId: ticket('P1').ticketId,
      ticketDate: '2026-11-24',
      ticketTime: '12:41',
      ticketTotalCents: 1230,
    });
    // Ticket de borne scanné : identifiant seul, sans journée ni total.
    const qr = await store.createEntry(
      {
        tenantId: BILLS,
        memberId: 'membre-test',
        ticketRef: `T${run}Q2`,
        instagramHandle: 'client.test',
        bonusPoints: 50,
        ticket: {
          ticketId: `6f1c1c2e-0000-4000-8000-${run}00b1`,
          date: null,
          time: null,
          totalCents: null,
        },
      },
      [],
    );
    expect(qr.ok && qr.entry).toMatchObject({ ticketCheck: 'pending', ticketDate: null });
    const pending = await store.pendingTicketChecks(500);
    expect(pending.some((e) => e.id === a.entry.id)).toBe(true);

    // Mention et délais échus : le contrôle passe, jamais le crédit tant que le ticket est à vérifier.
    const at = new Date();
    const later = new Date(at.getTime() + 25 * 3600_000);
    await store.markMention(BILLS, a.entry.id, {
      at,
      by: 'equipe@test',
      checkDueAt: new Date(at.getTime() + 20 * 3600_000),
      creditDueAt: new Date(at.getTime() + 24 * 3600_000),
    });
    await store.recordCheck(BILLS, a.entry.id, { at: later, result: 'online', actor: 'système' });
    expect((await store.dueEntries(later, 500)).some((e) => e.id === a.entry.id)).toBe(false);

    const event = { type: 'ticket_checked' as const, actor: 'système', detail: { result: 'x' } };
    const [v1, v2] = await Promise.all([
      store.recordTicketCheck(BILLS, a.entry.id, { at, result: 'verified', events: [event] }),
      store.recordTicketCheck(BILLS, a.entry.id, { at, result: 'verified', events: [event] }),
    ]);
    // Deux rapprochements simultanés : un seul passe.
    expect([v1, v2].filter(Boolean)).toHaveLength(1);
    expect((await store.dueEntries(later, 500)).some((e) => e.id === a.entry.id)).toBe(true);

    const unpaid = await store.recordTicketCheck(BILLS, b.entry.id, {
      at,
      result: 'unpaid',
      events: [event, { type: 'rejected', actor: 'système', detail: { reason: 'annulée' } }],
    });
    expect(unpaid).toMatchObject({ ticketCheck: 'unpaid', status: 'rejected' });
    expect(
      await store.recordTicketCheck(BELLA, c.entry.id, { at, result: 'verified', events: [] }),
    ).toBeNull();

    expect(await store.flagTicketReview(BILLS, c.entry.id, at, event)).toBe(true);
    expect(await store.flagTicketReview(BILLS, c.entry.id, at, event)).toBe(false);
    const notFound = await store.recordTicketCheck(BILLS, c.entry.id, {
      at,
      result: 'not_found',
      events: [event],
    });
    expect(notFound).toMatchObject({
      ticketCheck: 'not_found',
      needsReview: true,
      status: 'pending',
    });
    expect((await store.events(BILLS, [c.entry.id])).map((e) => e.type)).toEqual([
      'ticket_read',
      'ticket_checked',
      'ticket_checked',
    ]);
    const left = await store.pendingTicketChecks(500);
    expect(left.some((e) => [a.entry.id, b.entry.id, c.entry.id].includes(e.id))).toBe(false);
  });

  it('efface le membre : profil et participations en attente supprimés, décidées anonymisées', async () => {
    const member = `membre-${run}-efface`;
    await store.saveProfile(BILLS, member, 'compte.a.effacer');
    const entry = (ref: string) =>
      store.createEntry(
        {
          tenantId: BILLS,
          memberId: member,
          ticketRef: `T${run}${ref}`,
          instagramHandle: 'compte.a.effacer',
          bonusPoints: 50,
        },
        [{ type: 'created', actor: 'client', detail: { instagram: 'compte.a.effacer' } }],
      );
    const pending = await entry('EA');
    const decided = await entry('EB');
    if (!pending.ok || !decided.ok) throw new Error('participations non créées');
    await store.decide(BILLS, decided.entry.id, 'confirmed', new Date());
    // Autre enseigne : rien n'est touché.
    await store.saveProfile(BELLA, member, 'compte.a.effacer');

    expect(await store.forgetMember(BILLS, member)).toEqual({
      deletedEntries: 1,
      anonymisedEntries: 1,
    });
    expect(await store.getProfile(BILLS, member)).toBeNull();
    expect(await store.getProfile(BELLA, member)).toBe('compte.a.effacer');
    expect(await store.memberEntries(BILLS, member)).toEqual([]);
    expect(await store.getEntry(BILLS, pending.entry.id)).toBeNull();
    expect(await store.getEntry(BILLS, decided.entry.id)).toMatchObject({
      memberId: ERASED_MEMBER,
      instagramHandle: ERASED_MEMBER,
      status: 'confirmed',
      ticketRef: `T${run}EB`,
    });
    const [created] = await store.events(BILLS, [decided.entry.id]);
    expect(created?.detail).toEqual({});
    // Deuxième passage : plus rien à effacer.
    expect(await store.forgetMember(BILLS, member)).toEqual({
      deletedEntries: 0,
      anonymisedEntries: 0,
    });
    await sql`delete from public.ambassador_profiles where tenant_id = ${BELLA} and member_id = ${member}`;
  });
});
