import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROXIMITY_RULES,
  decideProximityPush,
  inDailyWindow,
  isOpenAt,
  nearestRegions,
  proximityRulesIssues,
  renderProximityText,
  type ProximityContext,
  type ProximityRules,
} from './proximity';
import { fromLocal } from './time';
import { distanceMeters } from './zones';

const TZ = 'Europe/Paris';
/** Instant à partir d'une heure locale de Paris. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return fromLocal(date, h * 60 + m, TZ);
};
const hoursBefore = (d: Date, h: number) => new Date(d.getTime() - h * 3_600_000);

// Mardi 24/11/2026 à 12:00 (heure de Paris), restaurant ouvert 11:30–14:30 et 18:30–22:30.
const NOON = at('2026-11-24', '12:00');

const rules: ProximityRules = {
  ...DEFAULT_PROXIMITY_RULES,
  enabled: true,
  quietHours: { start: '22:00', end: '08:00' },
};

const ctx = (over: Partial<ProximityContext> = {}): ProximityContext => ({
  now: NOON,
  restaurant: {
    available: true,
    timezone: TZ,
    openingHours: [2, 3, 4, 5, 6, 7].flatMap((d) => [
      { isoWeekday: d, opens: '11:30', closes: '14:30' },
      { isoWeekday: d, opens: '18:30', closes: '22:30' },
    ]),
    closures: [],
  },
  hasDevice: true,
  lastSentToMember: null,
  lastSentForRestaurant: null,
  points: 120,
  cheapestRewardCost: 100,
  lastOrderAt: null,
  ...over,
});

describe('décision d’envoi « à proximité »', () => {
  it('envoie quand toutes les règles sont respectées', () => {
    expect(decideProximityPush(rules, ctx())).toEqual({ send: true, reason: 'sent' });
  });

  it('désactivée par défaut et sans appareil inscrit : rien', () => {
    expect(DEFAULT_PROXIMITY_RULES.enabled).toBe(false);
    expect(decideProximityPush(DEFAULT_PROXIMITY_RULES, ctx()).reason).toBe('disabled');
    expect(decideProximityPush(rules, ctx({ hasDevice: false })).reason).toBe('no_device');
  });

  it('restaurant en pause ou sans coordonnées : rien', () => {
    const c = ctx();
    expect(
      decideProximityPush(rules, { ...c, restaurant: { ...c.restaurant, available: false } })
        .reason,
    ).toBe('restaurant_unavailable');
  });

  it('heures calmes qui passent minuit (22:00 → 08:00)', () => {
    expect(decideProximityPush(rules, ctx({ now: at('2026-11-24', '23:30') })).reason).toBe(
      'quiet_hours',
    );
    expect(decideProximityPush(rules, ctx({ now: at('2026-11-25', '07:59') })).reason).toBe(
      'quiet_hours',
    );
    expect(decideProximityPush(rules, ctx({ now: at('2026-11-24', '22:00') })).reason).toBe(
      'quiet_hours',
    );
    // 08:00 : fin des heures calmes ; mais le restaurant est fermé à cette heure.
    expect(decideProximityPush(rules, ctx({ now: at('2026-11-25', '08:00') })).reason).toBe(
      'closed',
    );
    const noOpening = { ...rules, onlyOpeningHours: false };
    expect(decideProximityPush(noOpening, ctx({ now: at('2026-11-25', '08:00') })).send).toBe(true);
    expect(decideProximityPush(noOpening, ctx({ now: at('2026-11-24', '21:59') })).send).toBe(true);
  });

  it('heures calmes dans la journée (14:00 → 15:00) et sans heures calmes', () => {
    const r = { ...rules, onlyOpeningHours: false, quietHours: { start: '14:00', end: '15:00' } };
    expect(decideProximityPush(r, ctx({ now: at('2026-11-24', '14:30') })).reason).toBe(
      'quiet_hours',
    );
    expect(decideProximityPush(r, ctx({ now: at('2026-11-24', '15:00') })).send).toBe(true);
    const none = { ...rules, onlyOpeningHours: false, quietHours: null };
    expect(decideProximityPush(none, ctx({ now: at('2026-11-24', '03:00') })).send).toBe(true);
  });

  it('heure locale de Paris, heure d’été comprise', () => {
    // 21:30 à Paris en juillet = 19:30 UTC : pas encore les heures calmes de 22:00.
    const july = new Date('2026-07-14T19:30:00Z');
    expect(decideProximityPush(rules, ctx({ now: july })).send).toBe(true);
    // 22:30 à Paris = 20:30 UTC : heures calmes.
    expect(decideProximityPush(rules, ctx({ now: new Date('2026-07-14T20:30:00Z') })).reason).toBe(
      'quiet_hours',
    );
  });

  it('seulement pendant les horaires d’ouverture du restaurant', () => {
    expect(decideProximityPush(rules, ctx({ now: at('2026-11-24', '16:00') })).reason).toBe(
      'closed',
    );
    // Lundi : fermé toute la journée.
    expect(decideProximityPush(rules, ctx({ now: at('2026-11-23', '12:00') })).reason).toBe(
      'closed',
    );
    const c = ctx();
    expect(
      decideProximityPush(rules, {
        ...c,
        restaurant: { ...c.restaurant, closures: ['2026-11-24'] },
      }).reason,
    ).toBe('closed');
    expect(
      decideProximityPush(
        { ...rules, onlyOpeningHours: false },
        ctx({ now: at('2026-11-24', '16:00') }),
      ).send,
    ).toBe(true);
  });

  it('plafond par membre : 1 notification par période, tous restaurants confondus', () => {
    expect(
      decideProximityPush(rules, ctx({ lastSentToMember: hoursBefore(NOON, 23.9) })).reason,
    ).toBe('member_cap');
    expect(decideProximityPush(rules, ctx({ lastSentToMember: hoursBefore(NOON, 24) })).send).toBe(
      true,
    );
    const r = { ...rules, memberCapHours: 2 };
    expect(decideProximityPush(r, ctx({ lastSentToMember: hoursBefore(NOON, 3) })).send).toBe(true);
  });

  it('plafond par restaurant (défaut 7 jours)', () => {
    const last = hoursBefore(NOON, 48);
    expect(
      decideProximityPush(rules, ctx({ lastSentToMember: last, lastSentForRestaurant: last }))
        .reason,
    ).toBe('restaurant_cap');
    const old = hoursBefore(NOON, 169);
    expect(
      decideProximityPush(rules, ctx({ lastSentToMember: old, lastSentForRestaurant: old })).send,
    ).toBe(true);
  });

  it('cible « cadeau disponible » : points ≥ cadeau le moins cher', () => {
    const r = { ...rules, target: 'reward' as const };
    expect(decideProximityPush(r, ctx({ points: 100 })).send).toBe(true);
    expect(decideProximityPush(r, ctx({ points: 99 })).reason).toBe('no_reward');
    expect(decideProximityPush(r, ctx({ cheapestRewardCost: null })).reason).toBe('no_reward');
    expect(decideProximityPush(r, ctx({ points: null })).reason).toBe('loyalty_unavailable');
    // La cible « tous » n'a pas besoin du solde.
    expect(decideProximityPush(rules, ctx({ points: null })).send).toBe(true);
  });

  it('cible « inactifs » : pas de commande depuis N jours (jamais commandé = inactif)', () => {
    const r = { ...rules, target: 'inactive' as const, inactiveDays: 30 };
    expect(decideProximityPush(r, ctx({ lastOrderAt: null })).send).toBe(true);
    expect(decideProximityPush(r, ctx({ lastOrderAt: hoursBefore(NOON, 24 * 31) })).send).toBe(
      true,
    );
    expect(decideProximityPush(r, ctx({ lastOrderAt: hoursBefore(NOON, 24 * 29) })).reason).toBe(
      'recently_active',
    );
  });

  it('ordre des règles : les plafonds passent avant la cible', () => {
    const r = { ...rules, target: 'reward' as const };
    expect(
      decideProximityPush(r, ctx({ points: 0, lastSentToMember: hoursBefore(NOON, 1) })).reason,
    ).toBe('member_cap');
  });
});

describe('outils', () => {
  it('plage quotidienne, minuit compris', () => {
    expect(inDailyWindow(23 * 60, 22 * 60, 8 * 60)).toBe(true);
    expect(inDailyWindow(8 * 60, 22 * 60, 8 * 60)).toBe(false);
    expect(inDailyWindow(12 * 60, 22 * 60, 8 * 60)).toBe(false);
    expect(inDailyWindow(600, 600, 600)).toBe(false);
  });

  it('ouverture à un instant donné', () => {
    const r = ctx().restaurant;
    expect(isOpenAt(r, at('2026-11-24', '11:30'))).toBe(true);
    expect(isOpenAt(r, at('2026-11-24', '14:30'))).toBe(false);
  });

  it('texte avec le nom du restaurant', () => {
    expect(renderProximityText('{restaurant} est tout près', 'Bella Bastille')).toBe(
      'Bella Bastille est tout près',
    );
    expect(renderProximityText('Chez {restaurant}, {restaurant} !', 'B')).toBe('Chez B, B !');
  });

  it('validation des règles', () => {
    expect(proximityRulesIssues(DEFAULT_PROXIMITY_RULES)).toEqual([]);
    expect(
      proximityRulesIssues({
        ...DEFAULT_PROXIMITY_RULES,
        radiusMeters: 50,
        title: ' ',
        quietHours: { start: '10:00', end: '10:00' },
        memberCapHours: 0,
      }),
    ).toEqual(['radius', 'title', 'quietHours', 'memberCap']);
    expect(proximityRulesIssues({ ...DEFAULT_PROXIMITY_RULES, radiusMeters: 1001 })).toEqual([
      'radius',
    ]);
  });

  it('distance (Bastille → Opéra ≈ 3,6 km)', () => {
    const d = distanceMeters(
      { latitude: 48.8553, longitude: 2.3747 },
      { latitude: 48.8719, longitude: 2.3316 },
    );
    expect(d).toBeGreaterThan(3500);
    expect(d).toBeLessThan(3700);
  });

  it('au plus 20 zones, les plus proches d’abord', () => {
    const places = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      latitude: 48 + i * 0.01,
      longitude: 2,
    }));
    const near = nearestRegions(places, { latitude: 48.295, longitude: 2 });
    expect(near).toHaveLength(20);
    expect(near[0]?.id).toBe('r29');
    expect(near.map((p) => p.id)).not.toContain('r0');
    expect(nearestRegions(places, null).map((p) => p.id)).toEqual(
      places.slice(0, 20).map((p) => p.id),
    );
    expect(nearestRegions(places, null, 50)).toHaveLength(20);
    expect(
      nearestRegions(
        [
          { latitude: Number.NaN, longitude: 2 },
          { latitude: 95, longitude: 2 },
        ],
        null,
      ),
    ).toEqual([]);
  });
});
