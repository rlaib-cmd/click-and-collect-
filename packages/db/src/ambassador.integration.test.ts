import { afterAll, describe, expect, it } from 'vitest';
import { createPostgresAmbassadorStore } from './ambassador';
import { createSql } from './client';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BILLS = '00000000-0000-4000-8000-000000000005';
const BELLA = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!url)('AmbassadorStore Postgres (lot 15)', () => {
  const sql = createSql(url ?? '', { max: 2 });
  const store = createPostgresAmbassadorStore(sql);
  const run = `${Date.now()}`.slice(-8);
  afterAll(async () => {
    await sql`delete from public.ambassador_entries where ticket_ref like ${`T${run}%`}`;
    await sql.end();
  });

  it('lit les réglages de Bills Burger et ceux, par défaut, d’une enseigne sans réglage', async () => {
    expect(await store.getSettings(BILLS)).toEqual({
      enabled: true,
      instagramHandle: 'billsburgerfr',
      bonusPoints: 50,
    });
    expect((await store.getSettings(BELLA)).enabled).toBe(false);
  });

  it('accepte une participation par ticket, puis ne la décide qu’une fois', async () => {
    const first = await store.createEntry({
      tenantId: BILLS,
      memberId: 'membre-test',
      ticketRef: `T${run}A`,
      instagramHandle: 'client.test',
      bonusPoints: 50,
    });
    expect(first.ok).toBe(true);
    const again = await store.createEntry({
      tenantId: BILLS,
      memberId: 'autre-membre',
      ticketRef: `T${run}A`,
      instagramHandle: 'autre',
      bonusPoints: 50,
    });
    expect(again).toEqual({ ok: false, error: 'ticket_already_used' });
    if (!first.ok) throw new Error('participation non créée');
    expect(first.entry.ticketQr).toBeNull();
    const scanned = await store.createEntry({
      tenantId: BILLS,
      memberId: 'membre-test',
      ticketRef: `T${run}Q`,
      ticketQr: `https://example.test/t?ticket=T${run}Q`,
      instagramHandle: 'client.test',
      bonusPoints: 50,
    });
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
});
