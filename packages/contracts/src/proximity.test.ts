import { describe, expect, it } from 'vitest';
import {
  proximityDeviceSchema,
  proximityEnterSchema,
  proximityPushDataSchema,
  proximitySettingsSchema,
} from './proximity';

const settings = {
  enabled: true,
  radiusMeters: 200,
  title: '{restaurant} est tout près',
  body: 'Commande en avance.',
  deepLink: 'commander',
  onlyOpeningHours: true,
  quietHours: { start: '22:00', end: '08:00' },
  memberCapHours: 24,
  restaurantCapHours: 168,
  target: 'all',
  inactiveDays: 30,
};

describe('bons plans à proximité', () => {
  it('règles : rayon de 100 à 1 000 m, heures HH:MM différentes', () => {
    expect(proximitySettingsSchema.safeParse(settings).success).toBe(true);
    for (const radiusMeters of [99, 1001, 150.5])
      expect(proximitySettingsSchema.safeParse({ ...settings, radiusMeters }).success).toBe(false);
    expect(
      proximitySettingsSchema.safeParse({
        ...settings,
        quietHours: { start: '24:00', end: '08:00' },
      }).success,
    ).toBe(false);
    expect(
      proximitySettingsSchema.safeParse({
        ...settings,
        quietHours: { start: '08:00', end: '08:00' },
      }).success,
    ).toBe(false);
    expect(proximitySettingsSchema.safeParse({ ...settings, quietHours: null }).success).toBe(true);
    expect(proximitySettingsSchema.safeParse({ ...settings, deepLink: 'https://x' }).success).toBe(
      false,
    );
    expect(proximitySettingsSchema.safeParse({ ...settings, title: '  ' }).success).toBe(false);
  });

  it('appareil : seul un jeton push Expo est accepté', () => {
    expect(
      proximityDeviceSchema.safeParse({ token: 'ExponentPushToken[abc_DEF-1]', platform: 'ios' })
        .success,
    ).toBe(true);
    expect(proximityDeviceSchema.safeParse({ token: 'abc', platform: 'ios' }).success).toBe(false);
    expect(
      proximityDeviceSchema.safeParse({ token: 'ExpoPushToken[a]', platform: 'web' }).success,
    ).toBe(false);
  });

  it('entrée dans une zone : identifiant de restaurant seulement (aucune position)', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    expect(proximityEnterSchema.parse({ restaurantId: id, latitude: 48.8 })).toEqual({
      restaurantId: id,
    });
    expect(proximityEnterSchema.safeParse({ restaurantId: 'x' }).success).toBe(false);
    expect(
      proximityPushDataSchema.safeParse({ kind: 'proximity', eventId: id, link: 'avantages' })
        .success,
    ).toBe(true);
  });
});
