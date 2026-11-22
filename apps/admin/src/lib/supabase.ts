'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

/** Client Supabase Auth (connexion uniquement : les données passent par l'API, ADR 0005). */
export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client =
    url && key
      ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
      : null;
  return client;
}

export const devLoginEnabled = process.env.NEXT_PUBLIC_ADMIN_DEV_LOGIN === '1';
