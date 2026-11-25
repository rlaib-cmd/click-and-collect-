import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresYoufidStore } from './loyalty-youfid';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('Fidélité YouFID : lien, registre, réglages (lot 21)', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const store = createPostgresYoufidStore(sql);
  const suffix = String(Date.now()).slice(-9);
  const usr = `9${suffix}`;
  afterAll(async () => {
    await sql`delete from public.loyalty_members_youfid where usr_id like ${`9${suffix}%`}`;
    await sql`delete from public.loyalty_operations where member_id like ${`9${suffix}%`}`;
    await sql`delete from public.loyalty_program_settings where tenant_id in (${BELLA}, ${GREEN})`;
    await sql.end();
  });

  it('enregistre le lien, garde le téléphone connu, met à jour le profil, cloisonne par enseigne', async () => {
    const created = await store.saveLink(BELLA, {
      usrId: usr,
      qrCode: 'QR1',
      phone: '+33612345678',
    });
    expect(created).toMatchObject({
      usrId: usr,
      qrCode: 'QR1',
      phone: '+33612345678',
      email: null,
    });
    const updated = await store.saveLink(BELLA, { usrId: usr, qrCode: 'QR2', phone: null });
    expect(updated).toMatchObject({ qrCode: 'QR2', phone: '+33612345678' });
    expect((await store.findLinkByPhone(BELLA, '+33612345678'))?.usrId).toBe(usr);
    expect(await store.getLink(GREEN, usr)).toBeNull();
    await store.updateLinkProfile(BELLA, usr, { email: 'a@example.fr', birthDate: '1990-04-12' });
    expect(await store.getLink(BELLA, usr)).toMatchObject({
      email: 'a@example.fr',
      birthDate: '1990-04-12',
    });
    await store.updateLinkProfile(BELLA, usr, { birthDate: null });
    expect(await store.getLink(BELLA, usr)).toMatchObject({
      email: 'a@example.fr',
      birthDate: null,
    });
    expect((await store.listLinks(BELLA, 50)).some((l) => l.usrId === usr)).toBe(true);
    expect(await store.deleteLink(GREEN, usr)).toBe(false);
    expect(await store.deleteLink(BELLA, usr)).toBe(true);
    expect(await store.getLink(BELLA, usr)).toBeNull();
  });

  it('réserve une opération une seule fois, même en parallèle ; « failed » est reprise', async () => {
    const op = {
      key: `order:${suffix}:earn`,
      kind: 'earn' as const,
      memberId: `${usr}1`,
      orderId: null,
      points: 120,
      label: 'Commande n° 1',
    };
    const claims = await Promise.all([1, 2, 3].map(() => store.claimOperation(BELLA, op)));
    expect(claims.filter((c) => c.claimed)).toHaveLength(1);
    await store.finishOperation(BELLA, op.key, { status: 'failed', error: 'api' });
    expect((await store.operationsToReview(BELLA, 50)).some((o) => o.key === op.key)).toBe(true);
    const again = await store.claimOperation(BELLA, op);
    expect(again).toMatchObject({ claimed: true, operation: { status: 'pending', attempts: 2 } });
    await store.finishOperation(BELLA, op.key, { status: 'done', responsePoints: 118 });
    const done = await store.claimOperation(BELLA, op);
    expect(done).toMatchObject({
      claimed: false,
      operation: { status: 'done', responsePoints: 118 },
    });
    // La même clé reste libre pour une autre enseigne.
    expect((await store.claimOperation(GREEN, op)).claimed).toBe(true);
    const history = await store.memberOperations(BELLA, op.memberId, 10);
    expect(history.map((o) => [o.kind, o.points, o.status])).toEqual([['earn', 120, 'done']]);
  });

  it('opération interrompue → uncertain, puis vérifiée à la main', async () => {
    const op = {
      key: `order:${suffix}:redeem`,
      kind: 'redeem' as const,
      memberId: `${usr}2`,
      orderId: '00000000-0000-4000-9000-000000000099',
      points: -300,
      label: 'Récompense',
    };
    await store.claimOperation(BELLA, op);
    expect(await store.markStale(BELLA, op.key, new Date(Date.now() - 60_000))).toBe(false);
    expect(await store.markStale(BELLA, op.key, new Date(Date.now() + 60_000))).toBe(true);
    const review = (await store.operationsToReview(BELLA, 50)).find((o) => o.key === op.key);
    expect(review).toMatchObject({
      status: 'uncertain',
      error: 'interrupted',
      orderId: op.orderId,
    });
    expect(await store.resolveOperation(GREEN, review?.id ?? '')).toBe(false);
    expect(await store.resolveOperation(BELLA, review?.id ?? '')).toBe(true);
    expect(await store.resolveOperation(BELLA, 'pas-un-uuid')).toBe(false);
  });

  it('réglages du programme : défauts 10 et 100, puis valeurs de l’enseigne', async () => {
    expect(await store.getProgramSettings(GREEN)).toEqual({
      pointsPerEuro: 10,
      welcomePoints: 100,
    });
    await store.saveProgramSettings(GREEN, { pointsPerEuro: 1, welcomePoints: 0 });
    expect(await store.getProgramSettings(GREEN)).toEqual({ pointsPerEuro: 1, welcomePoints: 0 });
  });
});
