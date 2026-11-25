import { describe, expect, it } from 'vitest';
import {
  createSplash360Client,
  type Splash360Gate,
  Splash360Error,
  splash360CredentialsFrom,
} from './client';
import { readCommandeStatus } from './status';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Faux serveur Splash360 : réponses programmées par chemin, appels enregistrés. */
function fakeServer(routes: Record<string, (call: Call) => { status: number; body: unknown }>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(call);
    const path = new URL(url).pathname;
    const route = routes[path];
    const res = route ? route(call) : { status: 404, body: { error: 'not found' } };
    return Promise.resolve(
      new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { fetch: fetchImpl, calls };
}

const creds = { baseUrl: 'https://splash.test/', clientId: 'id-test', clientSecret: 'secret-test' };
const token =
  (value = 'tok-1', expires = 3600) =>
  () => ({
    status: 200,
    body: { access_token: value, expires_in: expires, token_type: 'bearer' },
  });

describe('client Splash360', () => {
  it('demande un jeton client_credentials puis appelle la carte avec ce jeton', async () => {
    const server = fakeServer({
      '/oauth/v2/token': token(),
      '/api/export/v2/menus': () => ({ status: 200, body: { produits: [] } }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    expect(await client.getMenus()).toEqual({ produits: [] });
    const [tokenCall, menuCall] = server.calls;
    expect(tokenCall?.method).toBe('POST');
    // Consignes Splash360 : jeton sur api2, identifiants en Basic, portée « user ».
    expect(tokenCall?.url).toBe('https://api2.splash360.fr/oauth/v2/token');
    expect(tokenCall?.headers.Authorization).toBe(`Basic ${btoa('id-test:secret-test')}`);
    expect(Object.fromEntries(new URLSearchParams(tokenCall?.body ?? ''))).toEqual({
      grant_type: 'client_credentials',
      scope: 'user',
    });
    expect(tokenCall?.body).not.toContain('secret-test');
    expect(menuCall?.url).toBe('https://splash.test/api/export/v2/menus');
    expect(menuCall?.headers.Authorization).toBe('Bearer tok-1');
  });

  it('garde le jeton en cache puis le renouvelle avant expiration', async () => {
    let n = 0;
    let clock = 0;
    const server = fakeServer({
      '/oauth/v2/token': () => token(`tok-${++n}`, 120)(),
      '/api/export/v2/menus': () => ({ status: 200, body: {} }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch, now: () => clock });
    await client.getMenus();
    await client.getMenus();
    expect(server.calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
    clock = 61_000; // 120 s de vie − 60 s de marge
    await client.getMenus();
    expect(server.calls.at(-1)?.headers.Authorization).toBe('Bearer tok-2');
  });

  it('redemande un jeton une fois sur 401', async () => {
    let n = 0;
    const server = fakeServer({
      '/oauth/v2/token': () => token(`tok-${++n}`)(),
      '/api/export/v2/menus': (c) =>
        c.headers.Authorization === 'Bearer tok-1'
          ? { status: 401, body: { error: 'invalid_grant' } }
          : { status: 200, body: { ok: true } },
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    expect(await client.getMenus()).toEqual({ ok: true });
  });

  it('n’envoie jamais deux requêtes en même temps (appels séquentiels exigés par Splash360)', async () => {
    let active = 0;
    let maxActive = 0;
    const slow: typeof fetch = async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = url.endsWith('/token') ? { access_token: 't', expires_in: 86400 } : { ok: 1 };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const client = createSplash360Client({ ...creds, fetch: slow });
    await Promise.all([
      client.getMenus(),
      client.getCommandeStatus('a'),
      client.getCommandeStatus('b'),
      client.submitPaiement('c', []).catch(() => undefined),
    ]);
    expect(maxActive).toBe(1);
  });

  it('exporte les ventes sur api2 avec les identifiants principaux, filtre en paramètres', async () => {
    const server = fakeServer({
      '/oauth/v2/token': token(),
      '/api/export/orders': () => ({ status: 200, body: { data: [] } }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    await client.listSales({ fromDate: '2026-11-24', toDate: '2026-11-25', pageSize: 5 });
    const sales = server.calls[1];
    const url = new URL(sales?.url ?? '');
    expect(url.origin).toBe('https://api2.splash360.fr');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '0',
      pageSize: '5',
      fromDate: '2026-11-24',
      toDate: '2026-11-25',
      status: 'confirmed',
    });
    expect(sales?.headers.Authorization).toBe('Bearer tok-1');
    expect(server.calls[0]?.headers.Authorization).toBe(`Basic ${btoa('id-test:secret-test')}`);
  });

  it('utilise les identifiants dédiés aux ventes quand ils sont fournis', async () => {
    const server = fakeServer({
      '/oauth/v2/token': (c) =>
        token(c.headers.Authorization === `Basic ${btoa('ventes:s2')}` ? 'tok-v' : 'tok-m')(),
      '/api/export/orders': () => ({ status: 200, body: [] }),
    });
    const client = createSplash360Client({
      ...creds,
      ordersClientId: 'ventes',
      ordersClientSecret: 's2',
      fetch: server.fetch,
    });
    await client.listSales({ fromDate: '2026-11-25', toDate: '2026-11-25' });
    expect(server.calls.at(-1)?.headers.Authorization).toBe('Bearer tok-v');
  });

  it('utilise les identifiants dédiés à la carte quand ils sont fournis, et les principaux pour la caisse', async () => {
    const server = fakeServer({
      '/oauth/v2/token': (c) =>
        token(c.headers.Authorization === `Basic ${btoa('carte:s3')}` ? 'tok-c' : 'tok-m')(),
      '/api/export/v2/menus': () => ({ status: 200, body: {} }),
      '/api/export/cmdstatus/T1': () => ({ status: 200, body: { ccstatus: 'pending' } }),
    });
    const client = createSplash360Client({
      ...creds,
      menuClientId: 'carte',
      menuClientSecret: 's3',
      fetch: server.fetch,
    });
    await client.getMenus();
    expect(server.calls.at(-1)?.headers.Authorization).toBe('Bearer tok-c');
    await client.getCommandeStatus('T1');
    expect(server.calls.at(-1)?.headers.Authorization).toBe('Bearer tok-m');
  });

  it('envoie les identifiants de carte dans le corps quand c’est demandé, sans en-tête Basic', async () => {
    const server = fakeServer({
      '/oauth/v2/token': (c) => {
        const form = new URLSearchParams(String(c.body));
        return !c.headers.Authorization &&
          form.get('client_id') === 'carte' &&
          form.get('client_secret') === 's4' &&
          form.get('grant_type') === 'client_credentials'
          ? token('tok-c')()
          : { status: 400, body: { error: 'invalid_client' } };
      },
      '/api/export/v2/menus': () => ({ status: 200, body: { produits: [] } }),
    });
    const client = createSplash360Client({
      ...creds,
      menuClientId: 'carte',
      menuClientSecret: 's4',
      menuTokenAuth: 'body',
      fetch: server.fetch,
    });
    await client.getMenus();
    expect(server.calls.at(-1)?.headers.Authorization).toBe('Bearer tok-c');
  });

  it('repasse sur les identifiants principaux si ceux de la carte sont refusés', async () => {
    const server = fakeServer({
      '/oauth/v2/token': (c) =>
        c.headers.Authorization === `Basic ${btoa('carte:faux')}`
          ? { status: 400, body: { error: 'invalid_client' } }
          : token('tok-m')(),
      '/api/export/v2/menus': () => ({ status: 200, body: { produits: [] } }),
    });
    const client = createSplash360Client({
      ...creds,
      menuClientId: 'carte',
      menuClientSecret: 'faux',
      fetch: server.fetch,
    });
    expect(await client.getMenus()).toEqual({ produits: [] });
    expect(server.calls.at(-1)?.headers.Authorization).toBe('Bearer tok-m');
  });

  it('refuse un second export des ventes dans la minute, puis l’autorise', async () => {
    let clock = 1_000_000;
    const server = fakeServer({
      '/oauth/v2/token': token('tok', 86_400),
      '/api/export/orders': () => ({ status: 200, body: [] }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch, now: () => clock });
    const q = { fromDate: '2026-11-25', toDate: '2026-11-25' };
    await client.listSales(q);
    clock += 30_000;
    const error = await client.listSales(q).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Splash360Error);
    expect((error as Splash360Error).status).toBe(429);
    expect((error as Splash360Error).retryAfterMs).toBe(30_000);
    clock += 30_000;
    await client.listSales(q);
    expect(server.calls.filter((c) => c.url.includes('/orders'))).toHaveLength(2);
  });

  it('refuse un filtre de ventes invalide sans appeler Splash360', async () => {
    const server = fakeServer({});
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    for (const q of [
      { fromDate: '25/11/2026', toDate: '2026-11-25' },
      { fromDate: '2026-11-25', toDate: '2026-11-25', pageSize: 101 },
      { fromDate: '2026-11-25', toDate: '2026-11-25', page: -1 },
    ]) {
      await expect(client.listSales(q)).rejects.toBeInstanceOf(Splash360Error);
    }
    expect(server.calls).toHaveLength(0);
  });

  it('passe chaque échange par le verrou global, clé hachée sans identifiant en clair', async () => {
    const seen: string[] = [];
    let reserved = 0;
    const gate: Splash360Gate = {
      exclusive: (key, task) => {
        seen.push(key);
        return task();
      },
      reserveSales: () => Promise.resolve(reserved++ === 0 ? 0 : 42_000),
    };
    const server = fakeServer({
      '/oauth/v2/token': token(),
      '/api/export/v2/menus': () => ({ status: 200, body: {} }),
      '/api/export/orders': () => ({ status: 200, body: [] }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch, gate });
    await client.getMenus();
    await client.listSales({ fromDate: '2026-11-25', toDate: '2026-11-25' });
    const blocked = await client
      .listSales({ fromDate: '2026-11-25', toDate: '2026-11-25' })
      .catch((e: unknown) => e);
    expect((blocked as Splash360Error).retryAfterMs).toBe(42_000);
    expect(seen).toHaveLength(server.calls.length);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[0]).not.toContain('id-test');
  });

  it('signale une panne du verrou global comme réessayable', async () => {
    const gate: Splash360Gate = {
      exclusive: () => Promise.reject(new Error('lock timeout')),
      reserveSales: () => Promise.resolve(0),
    };
    const server = fakeServer({});
    const client = createSplash360Client({ ...creds, fetch: server.fetch, gate });
    await expect(client.getMenus()).rejects.toMatchObject({
      name: 'Splash360Error',
      retryable: true,
    });
    expect(server.calls).toHaveLength(0);
  });

  it('suit une URL de jeton et une portée configurées', async () => {
    const server = fakeServer({
      '/custom/token': token(),
      '/api/export/v2/menus': () => ({ status: 200, body: {} }),
    });
    const client = createSplash360Client({
      ...creds,
      tokenUrl: 'https://auth.test/custom/token',
      scope: 'autre',
      fetch: server.fetch,
    });
    await client.getMenus();
    expect(server.calls[0]?.url).toBe('https://auth.test/custom/token');
    expect(new URLSearchParams(server.calls[0]?.body ?? '').get('scope')).toBe('autre');
  });

  it('refuse sans réessai des identifiants invalides', async () => {
    const server = fakeServer({
      '/oauth/v2/token': () => ({ status: 400, body: { error: 'invalid_client' } }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    const error = await client.getMenus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Splash360Error);
    expect(error).toMatchObject({ status: 400, retryable: false });
  });

  it('signale une panne réseau comme réessayable', async () => {
    const client = createSplash360Client({
      ...creds,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(client.getMenus()).rejects.toMatchObject({ retryable: true, status: null });
  });

  it('soumet une commande et renvoie le ticketId', async () => {
    const server = fakeServer({
      '/oauth/v2/token': token(),
      '/api/import/submitcommande': () => ({
        status: 200,
        body: { status: 'success', ticketId: 'b3c1a7e2-0000-4000-8000-000000000001' },
      }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    const result = await client.submitCommande({
      provider: 'Test',
      mode: 'emporter',
      status: 'standby',
      total: 3.5,
      orderNumber: '1001',
      items: [{ itemid: 1, produitid: 'prd1826', quantite: 1, price: 3.5, ingredients: [] }],
      comments: [],
      client: { nom: 'Martin', prenom: 'Camille', telephone: '+33600000000', mode: 'emporter' },
      modificateurs: [],
    });
    expect(result.ticketId).toBe('b3c1a7e2-0000-4000-8000-000000000001');
    expect(JSON.parse(server.calls.at(-1)?.body ?? '{}')).toMatchObject({ status: 'standby' });
  });

  it("traite status: error comme un refus définitif, avec le message de l'API", async () => {
    const server = fakeServer({
      '/oauth/v2/token': token(),
      '/api/import/submitcmdpaiement/t1': () => ({
        status: 200,
        body: { status: 'error', error_message: 'Ticket inconnu' },
      }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    await expect(client.submitPaiement('t1', [])).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('Ticket inconnu') as string,
    });
  });

  it('classe 5xx et 429 en erreurs réessayables, 4xx en refus', async () => {
    const server = fakeServer({
      '/oauth/v2/token': token(),
      '/api/export/cmdstatus/a': () => ({ status: 503, body: null }),
      '/api/export/cmdstatus/b': () => ({ status: 429, body: null }),
      '/api/export/cmdstatus/c': () => ({ status: 422, body: { error_message: 'invalide' } }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    await expect(client.getCommandeStatus('a')).rejects.toMatchObject({ retryable: true });
    await expect(client.getCommandeStatus('b')).rejects.toMatchObject({ retryable: true });
    await expect(client.getCommandeStatus('c')).rejects.toMatchObject({ retryable: false });
  });
});

describe('readCommandeStatus', () => {
  it.each([
    [{ status: 'pending' }, 'pending'],
    [{ ticketId: 't', ccstatus: 'pending', numero: '' }, 'pending'],
    [{ ticketId: 't', ccstatus: 'ready', numero: '42' }, 'ready'],
    [{ ticketId: 't', ccstatus: 'verified', numero: '42' }, 'confirmed'],
    [{ status: 'standby' }, 'pending'],
    [{ status: 'READY' }, 'ready'],
    [{ status: 'success', statut: 'Prête' }, 'ready'],
    [{ status: 'confirmed' }, 'confirmed'],
    [{ status: 'verified' }, 'confirmed'],
    [{ status: 'Vérifiée' }, 'confirmed'],
    [{ status: 'success', commande: { status: 'confirmée' } }, 'confirmed'],
    [{ status: 'error', error_message: 'x' }, 'failed'],
    [{ status: 'cancelled_by_pos' }, 'failed'],
    [{ status: 'quelque_chose' }, 'pending'],
    [{ status: 'success' }, 'pending'],
    [null, 'pending'],
  ])('%j → %s', (body, state) => {
    expect(readCommandeStatus(body).state).toBe(state);
  });
});

describe('splash360CredentialsFrom', () => {
  it('exige identifiant et secret, URL par défaut', () => {
    const env: Record<string, string> = { SPLASH360_CLIENT_ID: 'a', SPLASH360_CLIENT_SECRET: 'b' };
    expect(splash360CredentialsFrom((k) => env[k])).toEqual({
      baseUrl: 'https://api.splash360.fr',
      clientId: 'a',
      clientSecret: 'b',
    });
    const full: Record<string, string> = {
      ...env,
      SPLASH360_TOKEN_URL: 'https://api2.splash360.fr/oauth/v2/token',
      SPLASH360_SCOPE: 'user',
      SPLASH360_MENU_PATH: '/api/export/v2/menus',
    };
    expect(splash360CredentialsFrom((k) => full[k])).toMatchObject({
      tokenUrl: 'https://api2.splash360.fr/oauth/v2/token',
      scope: 'user',
      menuPath: '/api/export/v2/menus',
    });
    expect(splash360CredentialsFrom(() => undefined)).toBeNull();
    expect(splash360CredentialsFrom((k) => (k === 'SPLASH360_CLIENT_ID' ? 'a' : ''))).toBeNull();
  });

  it('lit les identifiants dédiés aux ventes seulement s’ils sont complets', () => {
    const env: Record<string, string> = {
      SPLASH360_CLIENT_ID: 'a',
      SPLASH360_CLIENT_SECRET: 'b',
      SPLASH360_ORDERS_CLIENT_ID: 'v',
    };
    expect(splash360CredentialsFrom((k) => env[k])).not.toHaveProperty('ordersClientId');
    env.SPLASH360_ORDERS_CLIENT_SECRET = 'w';
    env.SPLASH360_ORDERS_API_URL = 'https://ventes.test';
    expect(splash360CredentialsFrom((k) => env[k])).toMatchObject({
      ordersClientId: 'v',
      ordersClientSecret: 'w',
      ordersBaseUrl: 'https://ventes.test',
    });
  });
});
