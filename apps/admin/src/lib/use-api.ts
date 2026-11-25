'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { api } from './api';
import { useSession } from './session';

/**
 * Lecture d'une ressource de l'API, avec rafraîchissement optionnel (tableau des commandes).
 *
 * Le schéma est lu via une référence, hors des dépendances : les pages le construisent souvent
 * à la volée (`z.object(...)` dans le rendu), ce qui en ferait un nouvel objet à chaque rendu.
 * L'avoir en dépendance relançait le chargement après chaque réponse, donc une boucle infinie
 * de requêtes (constatée en recette le 24/11 : ~200 requêtes par seconde par onglet ouvert).
 */
export function useApi<T extends z.ZodType>(path: string | null, schema: T, refreshMs?: number) {
  const { auth } = useSession();
  const [data, setData] = useState<z.infer<T> | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api(auth, path, schemaRef.current));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [auth, path]);

  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const id = setInterval(() => void load(), refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  return { data, error, reload: load };
}
