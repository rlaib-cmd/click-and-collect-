import { z } from 'zod';
import type { YoufidCredentials } from './client';

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const accountsSchema = z.record(
  z.string().regex(SUBDOMAIN),
  z.object({ login: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) }),
);

/**
 * Guillemets « intelligents » (“ ” „ ″) saisis depuis un téléphone remplacés par des
 * guillemets droits : la saisie du secret sur iPhone les transforme sans prévenir.
 */
export function normalizeQuotes(raw: string): string {
  return raw.trim().replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"');
}

/**
 * `YOUFID_ACCOUNTS` : objet JSON indexé par sous-domaine d'enseigne →
 * `{ "login": "…", "password": "…" }`. Les erreurs ne citent jamais les valeurs (secrets).
 * Absent ou vide : aucune enseigne branchée sur YouFID.
 */
export function parseYoufidAccounts(
  raw: string | undefined,
): ReadonlyMap<string, YoufidCredentials> {
  if (!raw || !raw.trim()) return new Map();
  let json: unknown;
  try {
    json = JSON.parse(normalizeQuotes(raw));
  } catch {
    throw new Error('YOUFID_ACCOUNTS : JSON invalide');
  }
  const parsed = accountsSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => i.path.map(String).slice(0, 2).join('.') || '(racine)')
      .join(', ');
    throw new Error(
      `YOUFID_ACCOUNTS invalide (${where}) : { "<sous-domaine>": { "login", "password" } } attendu`,
    );
  }
  return new Map(
    Object.entries(parsed.data).map(([sub, c]) => [sub, { login: c.login, password: c.password }]),
  );
}

/** Appareil stable par environnement (clé de session propre, 48 h) ; 100 caractères au plus. */
export function youfidDeviceId(explicit: string | undefined, environment: string): string {
  const id = explicit?.trim() || `splash360-commande-${environment}`;
  return id.slice(0, 100);
}
