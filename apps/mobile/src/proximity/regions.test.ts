import { describe, expect, it } from 'vitest';
import {
  geofenceRegions,
  parseProximityState,
  proximityAfterSession,
  proximityLinkPath,
  readProximityPush,
} from './regions';

const uuid = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const restaurants = Array.from({ length: 25 }, (_, i) => ({
  restaurantId: uuid(i),
  latitude: 48.8 + i * 0.01,
  longitude: 2.35,
}));

describe('zones surveillées', () => {
  it('au plus 20 zones, les plus proches d’abord, rayon de l’enseigne, entrée seulement', () => {
    const regions = geofenceRegions(
      { enabled: true, radiusMeters: 250, restaurants },
      { latitude: 49.04, longitude: 2.35 },
    );
    expect(regions).toHaveLength(20);
    expect(regions[0]).toEqual({
      identifier: uuid(24),
      latitude: 49.04,
      longitude: 2.35,
      radius: 250,
      notifyOnEnter: true,
      notifyOnExit: false,
    });
    // Les cinq plus éloignés (au sud) sont laissés de côté.
    expect(regions.map((r) => r.identifier)).not.toContain(uuid(0));
    expect(regions.map((r) => r.identifier)).not.toContain(uuid(4));
  });

  it('sans position connue : les 20 premiers ; fonction coupée : aucune zone', () => {
    const regions = geofenceRegions({ enabled: true, radiusMeters: 200, restaurants }, null);
    expect(regions.map((r) => r.identifier)).toEqual(
      restaurants.slice(0, 20).map((r) => r.restaurantId),
    );
    expect(geofenceRegions({ enabled: false, radiusMeters: 200, restaurants }, null)).toEqual([]);
    expect(geofenceRegions({ enabled: true, radiusMeters: 200, restaurants: [] }, null)).toEqual(
      [],
    );
  });
});

describe('notification touchée', () => {
  it('ouvre l’écran choisi par l’enseigne', () => {
    expect(proximityLinkPath('home')).toBe('/');
    expect(proximityLinkPath('commander')).toBe('/commander');
    expect(proximityLinkPath('avantages')).toBe('/avantages');
  });

  it('ne reconnaît que les notifications « à proximité »', () => {
    const data = { kind: 'proximity', eventId: uuid(1), link: 'commander' };
    expect(readProximityPush(data)).toEqual(data);
    expect(readProximityPush({ orderId: 'abc' })).toBeNull();
    expect(readProximityPush({ ...data, link: 'https://ailleurs.example' })).toBeNull();
    expect(readProximityPush(undefined)).toBeNull();
  });
});

describe('accord enregistré sur l’appareil', () => {
  const state = {
    subdomain: 'bella',
    memberToken: 'm2.101.abc.1.signature',
    pushToken: 'ExponentPushToken[x]',
  };

  it('relit l’état, ignore un contenu illisible', () => {
    expect(parseProximityState(JSON.stringify(state))).toEqual(state);
    expect(parseProximityState('{pas du json')).toBeNull();
    expect(parseProximityState(JSON.stringify({ subdomain: 'bella' }))).toBeNull();
    expect(parseProximityState(null)).toBeNull();
  });

  it('déconnexion ou autre membre : arrêt ; même membre reconnecté : conservé', () => {
    expect(proximityAfterSession(state, { subdomain: 'bella', memberToken: null })).toBe('stop');
    expect(
      proximityAfterSession(state, { subdomain: 'bella', memberToken: 'm2.202.abc.1.sig' }),
    ).toBe('stop');
    expect(
      proximityAfterSession(state, { subdomain: 'bella', memberToken: 'm2.101.def.2.autre' }),
    ).toBe('keep');
    expect(proximityAfterSession(null, { subdomain: 'bella', memberToken: null })).toBe('none');
    expect(proximityAfterSession(state, { subdomain: 'autre', memberToken: null })).toBe('none');
  });
});
