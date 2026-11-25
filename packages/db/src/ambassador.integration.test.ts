import { afterAll, describe, expect, it } from 'vitest';
import { createPostgresAmbassadorStore } from './ambassador';
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
    await sql`delete from public.ambassador_profiles where member_id = ${`membre-${run}`}`;
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
});
