'use client';

import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { api } from './api';
import { useSession } from './session';

/** Lecture d'une ressource de l'API, avec rafraîchissement optionnel (tableau des commandes). */
export function useApi<T extends z.ZodType>(path: string | null, schema: T, refreshMs?: number) {
  const { auth } = useSession();
  const [data, setData] = useState<z.infer<T> | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api(auth, path, schema));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [auth, path, schema]);

  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const id = setInterval(() => void load(), refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  return { data, error, reload: load };
}
