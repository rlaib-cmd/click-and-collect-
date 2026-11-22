import { createDemoMenuProvider, createMenuCache } from '@splash360/api-menu';
import {
  createMemoryRestaurantStore,
  createMemoryTenantStore,
  type Restaurant,
} from '@splash360/db';
import { createApp, type AppDeps } from './app';

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

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
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
