import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useApi } from './use-api';

/**
 * Budget de requêtes du back-office (audit du 25/11) : chaque test compte les appels réseau
 * avec un `fetch` simulé et des faux timers. Aucune requête réelle.
 */

// Session simulée : modifiable entre deux rendus (changement d'enseigne).
const session = {
  auth: { token: 'jeton', tenantId: 'A' as string | null },
  ready: true,
  reportUnauthorized: vi.fn(),
};
vi.mock('./session', () => ({ useSession: () => session }));

interface Call {
  url: string;
  signal: AbortSignal | undefined;
  respond(status: number, body: unknown, headers?: Record<string, string>): void;
}
let calls: Call[] = [];
/** Réponses automatiques (sinon la requête reste en attente jusqu'à `respond`). */
let auto:
  ((url: string) => { status: number; body: unknown; headers?: Record<string, string> }) | null;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  auto = null;
  session.auth = { token: 'jeton', tenantId: 'A' };
  session.ready = true;
  session.reportUnauthorized = vi.fn();
  setVisibility('visible');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input).replace(/^.*\/v1\/admin/, '');
      return new Promise<Response>((resolve, reject) => {
        const call: Call = {
          url,
          signal: init?.signal ?? undefined,
          respond(status, body, headers = {}) {
            const text = typeof body === 'string' ? body : JSON.stringify(body);
            resolve(new Response(status === 204 ? null : text, { status, headers }));
          },
        };
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('annulée', 'AbortError')),
        );
        calls.push(call);
        if (auto) {
          const r = auto(url);
          call.respond(r.status, r.body, r.headers);
        }
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Laisse les promesses se résoudre sans faire avancer l'horloge. */
const flush = () => act(async () => {});
const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

const list = (name: string) => ({ [name]: [{ id: 1 }] });

describe('useApi : un rendu ne relance jamais de requête', () => {
  it('schéma recréé à chaque rendu : une seule lecture, même après plusieurs rendus', async () => {
    auto = () => ({ status: 200, body: list('restaurants') });
    const { result, rerender } = renderHook(() =>
      // Schéma volontairement construit pendant le rendu, comme dans les pages fautives.
      useApi('/restaurants', z.object({ restaurants: z.array(z.object({ id: z.number() })) })),
    );
    await flush();
    for (let i = 0; i < 5; i++) rerender();
    await wait(60_000);
    expect(result.current.data).toEqual(list('restaurants'));
    expect(calls).toHaveLength(1);
  });

  it('deux lectures dans le même écran, réponses décalées : 2 requêtes, pas de relance croisée', async () => {
    const { result } = renderHook(() => ({
      restaurants: useApi('/restaurants', z.object({ restaurants: z.array(z.unknown()) })),
      staff: useApi('/staff', z.object({ staff: z.array(z.unknown()) })),
    }));
    expect(calls.map((c) => c.url)).toEqual(['/restaurants', '/staff']);
    await act(async () =>
      calls[1]?.respond(401, { error: { code: 'unauthorized', message: 'x' } }),
    );
    await wait(1000);
    await act(async () => calls[0]?.respond(200, { restaurants: [] }));
    await wait(60_000);
    expect(calls).toHaveLength(2);
    expect(result.current.restaurants.data).toEqual({ restaurants: [] });
  });
});

describe('useApi : le premier échec suspend le flux', () => {
  const cases: [string, number, unknown, Record<string, string>?][] = [
    ['401 session refusée', 401, { error: { code: 'unauthorized', message: 'Connexion requise' } }],
    ['403 droits insuffisants', 403, { error: { code: 'forbidden', message: 'Droits' } }],
    [
      '429 trop de requêtes',
      429,
      { error: { code: 'rate_limited', message: 'Trop' } },
      { 'Retry-After': '60' },
    ],
    ['500 erreur serveur', 500, { error: { code: 'internal_error', message: 'Erreur' } }],
    ['JSON invalide', 200, '<html>pas du json'],
    ['réponse hors contrat', 200, { autre: true }],
  ];
  it.each(cases)(
    '%s : une seule requête en 10 minutes, erreur exposée',
    async (_n, status, body, headers) => {
      auto = () => ({ status, body, ...(headers ? { headers } : {}) });
      const { result } = renderHook(() =>
        useApi('/orders', z.object({ orders: z.array(z.unknown()) }), 5000),
      );
      await wait(10 * 60_000);
      expect(calls).toHaveLength(1);
      expect(result.current.error).not.toBeNull();
      expect(session.reportUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    },
  );

  it('429 : « Réessayer » ne relit pas avant la fin du Retry-After', async () => {
    auto = () => ({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'Trop' } },
      headers: { 'Retry-After': '60' },
    });
    const { result } = renderHook(() =>
      useApi('/alerts', z.object({ alerts: z.array(z.unknown()) })),
    );
    await flush();
    await act(async () => result.current.reload());
    expect(calls).toHaveLength(1);
    await wait(61_000);
    auto = () => ({ status: 200, body: { alerts: [] } });
    await act(async () => result.current.reload());
    expect(calls).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });
});

describe('useApi : une seule lecture active par ressource', () => {
  it('lecture plus lente que l’intervalle et « Réessayer » répétés : au plus 1 requête active', async () => {
    const { result } = renderHook(() =>
      useApi('/orders', z.object({ orders: z.array(z.unknown()) }), 1000),
    );
    await wait(5000); // la réponse n'arrive pas
    await act(async () => {
      void result.current.reload();
      void result.current.reload();
    });
    expect(calls).toHaveLength(1);
    await act(async () => calls[0]?.respond(200, { orders: [] }));
    await flush();
    // La lecture suivante est planifiée après la fin de la précédente.
    expect(calls).toHaveLength(1);
    await wait(1000);
    expect(calls).toHaveLength(2);
  });

  it('chemin retiré : requête annulée et données remises à null', async () => {
    auto = () => ({ status: 200, body: { orders: [] } });
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) =>
        useApi(path, z.object({ orders: z.array(z.unknown()) })),
      { initialProps: { path: '/orders' as string | null } },
    );
    await flush();
    expect(result.current.data).toEqual({ orders: [] });
    rerender({ path: null });
    await flush();
    expect(result.current.data).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('useApi : budget de requêtes sur 10 minutes', () => {
  it('commandes 15 s, alertes 30 s, liste statique : au plus 41, 21 et 1 lectures', async () => {
    auto = (url) => ({
      status: 200,
      body:
        url === '/orders'
          ? { orders: [] }
          : url === '/alerts'
            ? { alerts: [] }
            : { restaurants: [] },
    });
    renderHook(() => ({
      orders: useApi('/orders', z.object({ orders: z.array(z.unknown()) }), 15_000),
      alerts: useApi('/alerts', z.object({ alerts: z.array(z.unknown()) }), 30_000),
      restaurants: useApi('/restaurants', z.object({ restaurants: z.array(z.unknown()) })),
    }));
    await wait(10 * 60_000);
    const count = (u: string) => calls.filter((c) => c.url === u).length;
    expect(count('/orders')).toBeLessThanOrEqual(41);
    expect(count('/alerts')).toBeLessThanOrEqual(21);
    expect(count('/restaurants')).toBe(1);
  });

  it('onglet masqué 10 minutes : aucune lecture, puis une seule au retour', async () => {
    auto = () => ({ status: 200, body: { orders: [] } });
    renderHook(() => useApi('/orders', z.object({ orders: z.array(z.unknown()) }), 15_000));
    await flush();
    expect(calls).toHaveLength(1);
    await act(async () => setVisibility('hidden'));
    await wait(10 * 60_000);
    expect(calls).toHaveLength(1);
    await act(async () => setVisibility('visible'));
    await wait(1);
    expect(calls).toHaveLength(2);
    await wait(10_000); // la suivante n'arrive qu'au bout de 15 s
    expect(calls).toHaveLength(2);
  });
});

describe('useApi : changement d’enseigne', () => {
  it('A puis B, réponse de B puis réponse tardive de A : les données de B restent', async () => {
    const { result, rerender } = renderHook(() =>
      useApi('/restaurants', z.object({ restaurants: z.array(z.string()) })),
    );
    expect(calls).toHaveLength(1);
    session.auth = { token: 'jeton', tenantId: 'B' };
    rerender();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);
    await act(async () => calls[1]?.respond(200, { restaurants: ['B'] }));
    await act(async () => calls[0]?.respond(200, { restaurants: ['A'] }));
    await flush();
    expect(result.current.data).toEqual({ restaurants: ['B'] });
  });

  it('enseigne en cours de résolution : aucune lecture tant qu’elle n’est pas confirmée', async () => {
    session.ready = false;
    const { rerender } = renderHook(() =>
      useApi('/restaurants', z.object({ restaurants: z.array(z.string()) })),
    );
    await wait(60_000);
    expect(calls).toHaveLength(0);
    session.ready = true;
    rerender();
    expect(calls).toHaveLength(1);
  });
});
