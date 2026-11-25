'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { z } from 'zod';
import { api, ApiError } from './api';
import { useSession } from './session';

/** Onglet visible : le rafraîchissement périodique s'arrête quand il est masqué. */
function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}

interface Flow {
  /** Génération de la ressource suivie : une réponse d'une génération passée est ignorée. */
  gen: number;
  controller: AbortController | null;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Dernière lecture en échec : plus de lecture automatique jusqu'à une action explicite. */
  failed: boolean;
  /** Pas de nouvel essai avant cette date (Retry-After d'un 429). */
  blockedUntil: number;
  lastOk: number;
}

/**
 * Lecture d'une ressource de l'API du back-office (audit du 25/11, F01 à F03).
 *
 * - Un rendu seul ne relance jamais de requête : la ressource est identifiée par une clé stable
 *   (utilisateur, enseigne, chemin) ; le schéma, souvent recréé à chaque rendu, est lu par référence.
 * - Une seule lecture active par ressource ; la suivante est planifiée après la fin de la précédente.
 * - Au premier échec (401, 403, 404, 429, 5xx, délai, réseau, réponse hors contrat), le flux est
 *   suspendu et l'erreur exposée : reprise uniquement par `reload()` (bouton « Réessayer »), et
 *   jamais avant l'échéance d'un Retry-After. Un 401 suspend toute la session (renvoi à la connexion).
 * - Changement de ressource, démontage ou contexte d'enseigne en cours de résolution : requête
 *   annulée, réponse tardive ignorée, données remises à null.
 * - Onglet masqué : pas de rafraîchissement périodique.
 */
export function useApi<T extends z.ZodType>(path: string | null, schema: T, refreshMs?: number) {
  const { auth, ready, reportUnauthorized } = useSession();
  const visible = useDocumentVisible();
  const key = path && ready ? `${auth.token}\n${auth.tenantId ?? ''}\n${path}` : null;

  const [state, setState] = useState<{
    key: string | null;
    data: z.infer<T> | null;
    error: Error | null;
  }>({ key: null, data: null, error: null });

  // Valeurs lues au moment de la requête, sans en faire des dépendances d'effet.
  const latest = useRef({ schema, auth, path, key, refreshMs, visible, reportUnauthorized });
  latest.current = { schema, auth, path, key, refreshMs, visible, reportUnauthorized };
  const flow = useRef<Flow>({
    gen: 0,
    controller: null,
    inFlight: null,
    timer: undefined,
    failed: false,
    blockedUntil: 0,
    lastOk: 0,
  });

  const run = useCallback((): Promise<void> => {
    const f = flow.current;
    if (f.inFlight) return f.inFlight;
    const { key: k, path: p, auth: a, schema: s } = latest.current;
    if (!k || !p) return Promise.resolve();
    clearTimeout(f.timer);
    const gen = f.gen;
    const controller = new AbortController();
    f.controller = controller;
    const request = api(a, p, s, { signal: controller.signal })
      .then((data: z.infer<T>) => {
        if (gen !== f.gen) return;
        f.failed = false;
        f.lastOk = Date.now();
        setState({ key: k, data, error: null });
        const { refreshMs: every, visible: shown } = latest.current;
        if (every && shown) f.timer = setTimeout(() => void run(), every);
      })
      .catch((e: unknown) => {
        if (gen !== f.gen || controller.signal.aborted) return;
        f.failed = true;
        const error = e instanceof Error ? e : new Error(String(e));
        if (error instanceof ApiError && error.retryAfterSeconds !== null)
          f.blockedUntil = Date.now() + error.retryAfterSeconds * 1000;
        setState((prev) => ({ ...prev, error }));
        if (error instanceof ApiError && error.status === 401) latest.current.reportUnauthorized();
      })
      .finally(() => {
        if (f.inFlight === request) f.inFlight = null;
      });
    f.inFlight = request;
    return request;
  }, []);

  // Nouvelle ressource (ou plus de ressource) : on repart de zéro.
  useEffect(() => {
    const f = flow.current;
    f.gen += 1;
    f.controller?.abort();
    f.inFlight = null;
    clearTimeout(f.timer);
    f.failed = false;
    f.blockedUntil = 0;
    f.lastOk = 0;
    setState({ key, data: null, error: null });
    if (key) void run();
    return () => {
      f.gen += 1;
      f.controller?.abort();
      f.inFlight = null;
      clearTimeout(f.timer);
    };
  }, [key, run]);

  // Rafraîchissement périodique : seulement onglet visible, flux sain et rien en cours.
  useEffect(() => {
    const f = flow.current;
    clearTimeout(f.timer);
    if (!key || !refreshMs || !visible || f.failed || f.inFlight) return;
    const wait = Math.max(0, f.lastOk + refreshMs - Date.now());
    f.timer = setTimeout(() => void run(), wait);
    return () => clearTimeout(f.timer);
  }, [key, refreshMs, visible, run]);

  /** Relecture explicite (bouton « Réessayer », après une modification) ; jamais en double. */
  const reload = useCallback((): Promise<void> => {
    const f = flow.current;
    if (f.inFlight) return f.inFlight;
    if (Date.now() < f.blockedUntil) return Promise.resolve();
    f.failed = false;
    setState((prev) => ({ ...prev, error: null }));
    return run();
  }, [run]);

  const current = state.key === key ? state : { data: null, error: null };
  return { data: current.data, error: current.error, reload };
}
