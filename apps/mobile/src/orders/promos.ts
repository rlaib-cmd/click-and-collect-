import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizePromoCode } from '@splash360/core';

/** Codes promo saisis par le client sur cet appareil (« Mes codes promo », lot 11). */
const key = (subdomain: string) => `promos:${subdomain}`;
const MAX_KEPT = 10;

export async function listSavedPromos(subdomain: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key(subdomain));
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data)
      ? data.flatMap((c) => {
          const code = typeof c === 'string' ? normalizePromoCode(c) : null;
          return code ? [code] : [];
        })
      : [];
  } catch {
    return [];
  }
}

/** Ajoute un code (normalisé) en tête de liste ; null si la saisie est mal formée. */
export async function savePromo(subdomain: string, input: string): Promise<string | null> {
  const code = normalizePromoCode(input);
  if (!code) return null;
  const list = (await listSavedPromos(subdomain)).filter((c) => c !== code);
  await AsyncStorage.setItem(key(subdomain), JSON.stringify([code, ...list].slice(0, MAX_KEPT)));
  return code;
}

export async function removePromo(subdomain: string, code: string): Promise<void> {
  const list = (await listSavedPromos(subdomain)).filter((c) => c !== code);
  await AsyncStorage.setItem(key(subdomain), JSON.stringify(list));
}
