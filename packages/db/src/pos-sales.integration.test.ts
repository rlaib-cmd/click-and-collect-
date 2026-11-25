import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresPosSalesStore } from './pos-sales';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BILLS = '00000000-0000-4000-8000-000000000005';
const BELLA = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!url)('PosSalesStore Postgres (lot 20)', () => {
  const sql = createSql(url ?? '', { max: 2 });
  const store = createPostgresPosSalesStore(sql);
  const run = `${Date.now()}`.slice(-8);
  const jour = '2026-11-20';
  afterAll(async () => {
    await sql`delete from public.pos_sales where ticket_id like ${`t-${run}-%`}`;
    await sql`delete from public.pos_sales_sync where tenant_id = ${BILLS} and jour = ${jour}`;
    await sql.end();
  });

  it('enregistre les ventes, met à jour le statut et retrouve un numéro par enseigne', async () => {
    const sale = {
      ticketId: `t-${run}-1`,
      restaurantId: '164',
      jourComptable: jour,
      numero: `N${run}`,
      status: 'confirmed' as const,
      totalCents: 1230,
    };
    await store.saveSales(
      BILLS,
      [sale, { ...sale, ticketId: `t-${run}-2`, numero: 'AUTRE' }],
      new Date(),
    );
    expect(await store.findSales(BILLS, jour, `N${run}`)).toEqual([sale]);
    await store.saveSales(BILLS, [{ ...sale, status: 'deleted' }], new Date());
    expect((await store.findSales(BILLS, jour, `N${run}`))[0]?.status).toBe('deleted');
    expect(await store.findSales(BELLA, jour, `N${run}`)).toEqual([]);
    expect(await store.findSales(BILLS, '2026-11-21', `N${run}`)).toEqual([]);
    await store.saveSales(BILLS, [], new Date());
  });

  it('garde l’avancement de la lecture par enseigne et par journée', async () => {
    expect(await store.getCursor(BILLS, jour)).toEqual({
      nextPage: 0,
      passAfterDay: false,
      complete: false,
    });
    await store.saveCursor(
      BILLS,
      jour,
      { nextPage: 2, passAfterDay: true, complete: false },
      new Date(),
    );
    await store.saveCursor(
      BILLS,
      jour,
      { nextPage: 3, passAfterDay: true, complete: true },
      new Date(),
    );
    expect(await store.getCursor(BILLS, jour)).toEqual({
      nextPage: 3,
      passAfterDay: true,
      complete: true,
    });
    expect((await store.getCursor(BELLA, jour)).complete).toBe(false);
  });
});
