import { nearestRegions, PROXIMITY_MAX_REGIONS } from '@splash360/core';
import {
  proximityPushDataSchema,
  type ProximityPushData,
  type ProximityRegionsDto,
} from '@splash360/contracts';
import { z } from 'zod';

/**
 * Outils purs des « Bons plans à proximité » (lot 22, ADR 0027), testés sans React Native.
 */

/** Zone surveillée par le système (forme de `LocationRegion` d'expo-location). */
export interface GeofenceRegion {
  /** Identifiant du restaurant : renvoyé tel quel à l'API à l'entrée dans la zone. */
  readonly identifier: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius: number;
  readonly notifyOnEnter: true;
  readonly notifyOnExit: false;
}

/**
 * Zones à surveiller : au plus 20 restaurants (limite iOS), les plus proches de la dernière
 * position connue d'abord ; sans position, les 20 premiers. Seule l'entrée est signalée.
 */
export function geofenceRegions(
  dto: ProximityRegionsDto,
  origin: { readonly latitude: number; readonly longitude: number } | null,
): GeofenceRegion[] {
  if (!dto.enabled) return [];
  return nearestRegions(dto.restaurants, origin, PROXIMITY_MAX_REGIONS).map((r) => ({
    identifier: r.restaurantId,
    latitude: r.latitude,
    longitude: r.longitude,
    radius: dto.radiusMeters,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
}

/** Écran ouvert au toucher de la notification. */
export function proximityLinkPath(
  link: ProximityPushData['link'],
): '/' | '/commander' | '/avantages' {
  switch (link) {
    case 'commander':
      return '/commander';
    case 'avantages':
      return '/avantages';
    default:
      return '/';
  }
}

/** Données d'une notification « à proximité », ou null pour toute autre notification. */
export function readProximityPush(data: unknown): ProximityPushData | null {
  const parsed = proximityPushDataSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Clé de stockage de l'accord sur l'appareil. */
export const PROXIMITY_STATE_KEY = 'splash360:proximite';

/** Accord conservé sur l'appareil : enseigne, session du membre et jeton push inscrits. */
export const proximityStateSchema = z.object({
  subdomain: z.string().min(1),
  memberToken: z.string().min(1),
  pushToken: z.string().min(1),
});
export type ProximityState = z.infer<typeof proximityStateSchema>;

export function parseProximityState(raw: string | null): ProximityState | null {
  if (!raw) return null;
  try {
    const parsed = proximityStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Ce qu'il faut faire de l'accord enregistré quand la session du membre change. */
export function proximityAfterSession(
  state: ProximityState | null,
  current: { readonly subdomain: string; readonly memberToken: string | null },
): 'keep' | 'stop' | 'none' {
  if (!state || state.subdomain !== current.subdomain) return 'none';
  // Déconnexion ou autre membre sur le téléphone : l'accord ne vaut que pour celui qui l'a donné.
  if (!current.memberToken) return 'stop';
  return memberOf(current.memberToken) === memberOf(state.memberToken) ? 'keep' : 'stop';
}

/** Identifiant du membre dans un jeton « m2.<id>.… » (lecture seule, pas de vérification). */
function memberOf(token: string): string {
  return token.split('.')[1] ?? '';
}
