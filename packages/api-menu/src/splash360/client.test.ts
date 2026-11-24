import { describe, expect, it } from 'vitest';
import { createSplash360Client, Splash360Error, splash360CredentialsFrom } from './client';
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
      '/api/export/menus': () => ({ status: 200, body: { produits: [] } }),
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    expect(await client.getMenus()).toEqual({ produits: [] });
    const [tokenCall, menuCall] = server.calls;
    expect(tokenCall?.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(tokenCall?.body ?? ''))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'id-test',
      client_secret: 'secret-test',
    });
    expect(menuCall?.url).toBe('https://splash.test/api/export/menus');
    expect(menuCall?.headers.Authorization).toBe('Bearer tok-1');
  });

  it('garde le jeton en cache puis le renouvelle avant expiration', async () => {
    let n = 0;
    let clock = 0;
    const server = fakeServer({
      '/oauth/v2/token': () => token(`tok-${++n}`, 120)(),
      '/api/export/menus': () => ({ status: 200, body: {} }),
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
      '/api/export/menus': (c) =>
        c.headers.Authorization === 'Bearer tok-1'
          ? { status: 401, body: { error: 'invalid_grant' } }
          : { status: 200, body: { ok: true } },
    });
    const client = createSplash360Client({ ...creds, fetch: server.fetch });
    expect(await client.getMenus()).toEqual({ ok: true });
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
    expect(splash360CredentialsFrom(() => undefined)).toBeNull();
    expect(splash360CredentialsFrom((k) => (k === 'SPLASH360_CLIENT_ID' ? 'a' : ''))).toBeNull();
  });
});
