import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresTenantStore } from './tenants';

/**
 * Tests d'intégration : nécessitent DATABASE_URL pointant sur une base migrée
 * et chargée avec supabase/seed.sql (fait par la CI).
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('TenantStore Postgres', () => {
  const sql = createSql(url ?? '', { max: 2 });
  const store = createPostgresTenantStore(sql);
  afterAll(() => sql.end());

  it("lit une enseigne et son thème par sous-domaine", async () => {
    const bella = await store.findBySubdomain('bella');
    expect(bella).toMatchObject({
      name: 'Pizzeria Bella',
      status: 'active',
      theme: { primaryColor: '#C8102E', mode: 'light' },
    });
  });

  it('renvoie le statut suspendu et un thème absent', async () => {
    expect(await store.findBySubdomain('suspendue')).toMatchObject({ status: 'suspended', theme: null });
  });

  it("renvoie null pour une enseigne inconnue", async () => {
    expect(await store.findBySubdomain('inconnue')).toBeNull();
  });
});
