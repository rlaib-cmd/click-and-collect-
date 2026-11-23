import {
  tenantConfigSchema,
  themeDraftStateSchema,
  themePreviewLinkSchema,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { createMemoryAssetStorage } from '../admin/logo';
import { GREEN_ID, sessionToken, testSetup } from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };
const as = async (email: string, tenantId?: string) => ({
  Authorization: `Bearer ${await sessionToken(email)}`,
  ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
  ...json,
});

const draft = {
  primaryColor: '#0B6E4F',
  mode: 'dark',
  logoUrl: 'https://cdn.example.fr/logo.png',
  tagline: 'Nouveau slogan',
  style: { header: 'brand', corners: 'pill', uppercaseTitles: true, pattern: 'checker' },
  loyaltyColor: '#F2B705',
} as const;

const config = async (app: ReturnType<typeof testSetup>['app'], query = '') =>
  tenantConfigSchema.parse(await (await app.request(`/v1/tenants/bella/config${query}`)).json());

describe('studio design : brouillon et publication (lot 12)', () => {
  it('le brouillon ne change pas l’application avant publication', async () => {
    const { app } = testSetup();
    const headers = await as('gerant@bella.test');
    const put = await app.request('/v1/admin/theme/draft', {
      method: 'PUT',
      headers,
      body: JSON.stringify(draft),
    });
    expect(put.status).toBe(204);

    const state = themeDraftStateSchema.parse(
      await (await app.request('/v1/admin/theme/draft', { headers })).json(),
    );
    expect(state.draft).toEqual(draft);
    expect(state.live.primaryColor).toBe('#C8102E');
    expect((await config(app)).theme.primaryColor).toBe('#C8102E');

    const publish = await app.request('/v1/admin/theme/publish', { method: 'POST', headers });
    expect(publish.status).toBe(200);
    expect(await publish.json()).toMatchObject({
      changes: expect.arrayContaining(['primaryColor', 'logoUrl', 'mode']),
    });
    expect((await config(app)).theme).toEqual(draft);
    const after = themeDraftStateSchema.parse(
      await (await app.request('/v1/admin/theme/draft', { headers })).json(),
    );
    expect(after.draft).toBeNull();
  });

  it('annuler efface le brouillon ; publier sans brouillon est refusé', async () => {
    const { app } = testSetup();
    const headers = await as('gerant@bella.test');
    await app.request('/v1/admin/theme/draft', {
      method: 'PUT',
      headers,
      body: JSON.stringify(draft),
    });
    expect((await app.request('/v1/admin/theme/discard', { method: 'POST', headers })).status).toBe(
      204,
    );
    expect((await app.request('/v1/admin/theme/publish', { method: 'POST', headers })).status).toBe(
      409,
    );
    expect((await config(app)).theme.primaryColor).toBe('#C8102E');
  });

  it('réservé aux administrateurs ; un design invalide est refusé', async () => {
    const { app } = testSetup();
    const staff = await as('equipe@bella.test');
    expect((await app.request('/v1/admin/theme/draft', { headers: staff })).status).toBe(403);
    const bad = await app.request('/v1/admin/theme/draft', {
      method: 'PUT',
      headers: await as('gerant@bella.test'),
      body: JSON.stringify({ ...draft, primaryColor: 'rouge' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('studio design : lien d’aperçu (lot 12)', () => {
  it('le lien montre le brouillon de son enseigne, et seulement elle', async () => {
    const setup = testSetup();
    const headers = await as('gerant@bella.test');
    await setup.app.request('/v1/admin/theme/draft', {
      method: 'PUT',
      headers,
      body: JSON.stringify(draft),
    });
    const link = themePreviewLinkSchema.parse(
      await (
        await setup.app.request('/v1/admin/theme/preview-link', { method: 'POST', headers })
      ).json(),
    );
    const token = encodeURIComponent(link.token);
    const res = await setup.app.request(`/v1/tenants/bella/config?preview=${token}`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const preview = tenantConfigSchema.parse(await res.json());
    expect(preview.preview).toBe(true);
    expect(preview.theme).toEqual(draft);

    // Autre enseigne : le jeton ne vaut rien, version publiée sans erreur.
    const other = await setup.app.request(`/v1/tenants/greenbowl/config?preview=${token}`);
    expect(other.status).toBe(200);
    expect(tenantConfigSchema.parse(await other.json()).preview).toBeUndefined();
  });

  it('un jeton faux ou expiré sert la version publiée', async () => {
    let now = new Date('2026-11-23T12:00:00Z');
    const setup = testSetup({ now: () => now });
    const headers = await as('gerant@bella.test');
    await setup.app.request('/v1/admin/theme/draft', {
      method: 'PUT',
      headers,
      body: JSON.stringify(draft),
    });
    const link = themePreviewLinkSchema.parse(
      await (
        await setup.app.request('/v1/admin/theme/preview-link', { method: 'POST', headers })
      ).json(),
    );
    expect((await config(setup.app, '?preview=faux')).theme.primaryColor).toBe('#C8102E');
    now = new Date(now.getTime() + 31 * 60_000);
    const expired = await config(setup.app, `?preview=${encodeURIComponent(link.token)}`);
    expect(expired.preview).toBeUndefined();
    expect(expired.theme.primaryColor).toBe('#C8102E');
  });
});

describe('studio design : logo téléversé (lot 12)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('range le logo dans le dossier de l’enseigne et le met au brouillon', async () => {
    const { storage, files } = createMemoryAssetStorage();
    const { app } = testSetup({ assets: storage });
    const headers = await as('gerant@bella.test');
    const res = await app.request('/v1/admin/theme/logo', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/png' },
      body: png,
    });
    expect(res.status).toBe(201);
    const { logoUrl } = (await res.json()) as { logoUrl: string };
    expect([...files.keys()][0]).toMatch(
      /^00000000-0000-4000-8000-000000000001\/logo-[0-9a-f]{16}\.png$/,
    );
    const state = themeDraftStateSchema.parse(
      await (await app.request('/v1/admin/theme/draft', { headers })).json(),
    );
    expect(state.draft?.logoUrl).toBe(logoUrl);
    expect(state.live.logoUrl).toBeNull();
  });

  it('refuse un SVG, un fichier trop lourd et le personnel', async () => {
    const { storage, files } = createMemoryAssetStorage();
    const { app } = testSetup({ assets: storage });
    const headers = await as('gerant@bella.test');
    const svg = await app.request('/v1/admin/theme/logo', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/svg+xml' },
      body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    });
    expect(svg.status).toBe(400);
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set(png);
    const heavy = await app.request('/v1/admin/theme/logo', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/png' },
      body: big,
    });
    expect(heavy.status).toBe(413);
    const staff = await app.request('/v1/admin/theme/logo', {
      method: 'POST',
      headers: { ...(await as('equipe@bella.test')), 'Content-Type': 'image/png' },
      body: png,
    });
    expect(staff.status).toBe(403);
    expect(files.size).toBe(0);
  });

  it('sans stockage configuré, le téléversement est indisponible', async () => {
    const { app } = testSetup();
    const res = await app.request('/v1/admin/theme/logo', {
      method: 'POST',
      headers: { ...(await as('gerant@bella.test')), 'Content-Type': 'image/png' },
      body: png,
    });
    expect(res.status).toBe(503);
  });

  it('le cloisonnement des enseignes vaut aussi pour le brouillon', async () => {
    const { app } = testSetup();
    await app.request('/v1/admin/theme/draft', {
      method: 'PUT',
      headers: await as('gerant@bella.test'),
      body: JSON.stringify(draft),
    });
    const res = await app.request('/v1/admin/theme/draft', {
      headers: await as('gerant@bella.test', GREEN_ID),
    });
    // Le gérant de Bella ne choisit pas d'autre enseigne : sa propre enseigne lui est imposée.
    const state = themeDraftStateSchema.parse(await res.json());
    expect(state.draft).toEqual(draft);
  });
});
