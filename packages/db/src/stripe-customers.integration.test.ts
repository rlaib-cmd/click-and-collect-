import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresStripeCustomerStore } from './stripe-customers';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('StripeCustomerStore Postgres (lot 18)', () => {
  const sql = createSql(url ?? '', { max: 2 });
  const store = createPostgresStripeCustomerStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.stripe_customers where member_id like ${`m-${run}-%`}`;
    await sql.end();
  });

  it('un client Stripe par membre et par enseigne, le premier enregistré gagne', async () => {
    const member = `m-${run}-a`;
    expect(await store.find(BELLA, member)).toBeNull();
    expect(await store.save(BELLA, member, `cus_${run}A`)).toBe(`cus_${run}A`);
    // Course entre deux requêtes : le second client créé n'est pas retenu.
    expect(await store.save(BELLA, member, `cus_${run}B`)).toBe(`cus_${run}A`);
    expect(await store.find(BELLA, member)).toBe(`cus_${run}A`);
    // Même identifiant de membre dans une autre enseigne : rien de partagé.
    expect(await store.find(GREEN, member)).toBeNull();
  });
});
