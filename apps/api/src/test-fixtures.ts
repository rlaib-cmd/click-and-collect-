import { createDemoMenuProvider, createMenuCache } from '@splash360/api-menu';
import {
  createMemoryRestaurantStore,
  createMemoryTenantStore,
  type OrderingConfig,
  type Restaurant,
} from '@splash360/db';
import { cents } from '@splash360/core';
import { createApp, type AppDeps } from './app';
import { createDemoGeoProvider } from './geo';
import { createMemoryOrderingStore } from './memory-ordering';

export const BELLA_ID = '00000000-0000-4000-8000-000000000001';
export const GREEN_ID = '00000000-0000-4000-8000-000000000002';
export const BELLA_RESTO = '10000000-0000-4000-8000-000000000001';
export const GREEN_RESTO = '10000000-0000-4000-8000-000000000002';

const restaurant = (
  r: Partial<Restaurant> & Pick<Restaurant, 'id' | 'tenantId' | 'name' | 'splash360Id'>,
): Restaurant => ({
  addressLine: '1 rue de Paris',
  postalCode: '75001',
  city: 'Paris',
  latitude: 48.86,
  longitude: 2.34,
  stripeAccountId: null,
  status: 'active',
  ...r,
});

/** Bella : livraison et retrait, 11:30–14:30 et 18:30–22:30 du mardi au dimanche, 2 commandes max par créneau. */
export const bellaConfig: OrderingConfig = {
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryMinutes: 15,
  schedule: {
    timezone: 'Europe/Paris',
    openingHours: [2, 3, 4, 5, 6, 7].flatMap((d) => [
      { isoWeekday: d, opens: '11:30', closes: '14:30' },
      { isoWeekday: d, opens: '18:30', closes: '22:30' },
    ]),
    closures: [],
    slotStepMinutes: 15,
    prepMinutes: 20,
    maxOrdersPerSlot: 2,
    daysAhead: 7,
  },
  fees: {
    deliveryMinimumCents: cents(1500),
    freeDeliveryThresholdCents: cents(3500),
    serviceFeeCents: cents(0),
  },
  zones: [{ id: 'zone-2km', kind: 'radius', radiusMeters: 2000, feeCents: cents(190) }],
};

/** Mardi 24 novembre 2026, 10:00 à Paris (restaurant pas encore ouvert). */
export const NOW = new Date('2026-11-24T09:00:00.000Z');

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    ordering: createMemoryOrderingStore({ [BELLA_RESTO]: bellaConfig }),
    geo: createDemoGeoProvider(),
    now: () => NOW,
    tenants: createMemoryTenantStore([
      {
        id: BELLA_ID,
        name: 'Pizzeria Bella',
        subdomain: 'bella',
        status: 'active',
        theme: { primaryColor: '#C8102E', mode: 'light', logoUrl: null, tagline: 'Napolitaine' },
      },
      { id: GREEN_ID, name: 'Green Bowl', subdomain: 'greenbowl', status: 'active', theme: null },
      {
        id: '00000000-0000-4000-8000-000000000003',
        name: 'Suspendue',
        subdomain: 'suspendue',
        status: 'suspended',
        theme: null,
      },
    ]),
    restaurants: createMemoryRestaurantStore([
      restaurant({
        id: BELLA_RESTO,
        tenantId: BELLA_ID,
        name: 'Bella Bastille',
        splash360Id: 'S360-R-BELLA-1',
        latitude: 48.8553,
        longitude: 2.3747,
      }),
      restaurant({
        id: GREEN_RESTO,
        tenantId: GREEN_ID,
        name: 'Green Bowl Opéra',
        splash360Id: 'S360-R-GREEN-1',
      }),
    ]),
    menus: createMenuCache(createDemoMenuProvider(), { ttlMs: 60_000, maxStaleMs: 0 }),
    ...overrides,
  };
}

export const testApp = (overrides: Partial<AppDeps> = {}) => createApp(testDeps(overrides));
