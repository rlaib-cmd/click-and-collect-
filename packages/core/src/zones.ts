import type { Cents } from './money';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export type DeliveryZone =
  | {
      readonly id: string;
      readonly kind: 'radius';
      /** Rayon en mètres autour du restaurant. */
      readonly radiusMeters: number;
      readonly feeCents: Cents;
    }
  | {
      readonly id: string;
      readonly kind: 'postal_codes';
      readonly postalCodes: readonly string[];
      readonly feeCents: Cents;
    };

export interface DeliveryAddress {
  readonly postalCode: string;
  readonly location: GeoPoint | null;
}

const EARTH_RADIUS_M = 6_371_000;

/** Distance à vol d'oiseau (haversine), en mètres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Zone qui dessert l'adresse, la moins chère si plusieurs conviennent ; null si hors zone.
 * Une zone « rayon » exige les coordonnées de l'adresse et du restaurant.
 */
export function findDeliveryZone(
  address: DeliveryAddress,
  restaurant: GeoPoint | null,
  zones: readonly DeliveryZone[],
): DeliveryZone | null {
  const matching = zones.filter((zone) => {
    if (zone.kind === 'postal_codes') return zone.postalCodes.includes(address.postalCode.trim());
    if (!address.location || !restaurant) return false;
    return distanceMeters(restaurant, address.location) <= zone.radiusMeters;
  });
  if (matching.length === 0) return null;
  return matching.reduce((best, z) => (z.feeCents < best.feeCents ? z : best));
}
