import { describe, expect, it } from 'vitest';
import { cents } from './money';
import { distanceMeters, findDeliveryZone, type DeliveryZone } from './zones';

const restaurant = { latitude: 48.8534, longitude: 2.3488 }; // Notre-Dame
const zones: DeliveryZone[] = [
  { id: 'proche', kind: 'radius', radiusMeters: 2000, feeCents: cents(190) },
  { id: 'loin', kind: 'radius', radiusMeters: 5000, feeCents: cents(390) },
  { id: 'cp', kind: 'postal_codes', postalCodes: ['92100'], feeCents: cents(490) },
];

describe('zones de livraison', () => {
  it('mesure une distance plausible', () => {
    const louvre = { latitude: 48.8606, longitude: 2.3376 };
    expect(distanceMeters(restaurant, louvre)).toBeGreaterThan(1000);
    expect(distanceMeters(restaurant, louvre)).toBeLessThan(1300);
  });

  it('choisit la zone la moins chère qui couvre l’adresse', () => {
    const louvre = { postalCode: '75001', location: { latitude: 48.8606, longitude: 2.3376 } };
    expect(findDeliveryZone(louvre, restaurant, zones)?.id).toBe('proche');
    const bastilleLoin = {
      postalCode: '75012',
      location: { latitude: 48.8399, longitude: 2.3958 },
    };
    expect(findDeliveryZone(bastilleLoin, restaurant, zones)?.id).toBe('loin');
  });

  it('reconnaît une zone par code postal', () => {
    expect(findDeliveryZone({ postalCode: '92100', location: null }, restaurant, zones)?.id).toBe(
      'cp',
    );
  });

  it('renvoie null hors zone ou sans coordonnées pour un rayon', () => {
    expect(findDeliveryZone({ postalCode: '75015', location: null }, restaurant, zones)).toBeNull();
    const versailles = { postalCode: '78000', location: { latitude: 48.8049, longitude: 2.1204 } };
    expect(findDeliveryZone(versailles, restaurant, zones)).toBeNull();
  });
});
