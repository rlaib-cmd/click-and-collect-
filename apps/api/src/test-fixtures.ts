import { DEFAULT_STYLE } from '@splash360/theme';
import { createDemoMenuProvider, createMenuCache } from '@splash360/api-menu';
import { cents } from '@splash360/core';
import {
  createMemoryAmbassadorStore,
  createMemoryRestaurantStore,
  createMemoryTenantStore,
  type OrderingConfig,
  type Restaurant,
  type RestaurantSettingsRecord,
  type TenantWithTheme,
} from '@splash360/db';
import { SignJWT } from 'jose';
import { createSupabaseVerifier } from './admin/auth';
import { createApp, type AppDeps } from './app';
import { createMemoryAdminStore } from './memory-admin';
import { createDemoGeoProvider } from './geo';
import { createMemoryOrderBackend } from './memory-ordering';
import { createFakeNotificationSender } from './notifications/sender';
import { createFakeGateway } from './payments/fake-gateway';
import { createDemoPosGateway } from './pos/gateway';

export const BELLA_ID = '00000000-0000-4000-8000-000000000001';
export const GREEN_ID = '00000000-0000-4000-8000-000000000002';
export const BELLA_RESTO = '10000000-0000-4000-8000-000000000001';
export const GREEN_RESTO = '10000000-0000-4000-8000-000000000002';
export const TOKEN_SECRET = 'secret-de-test-pour-les-jetons-de-suivi';
export const POS_SECRET = 'secret-partage-caisse-de-test-0123456789';

const restaurant = (
  r: Partial<Restaurant> & Pick<Restaurant, 'id' | 'tenantId' | 'name' | 'splash360Id'>,
): Restaurant => ({
  addressLine: '1 rue de Paris',
  postalCode: '75001',
  city: 'Paris',
  latitude: 48.86,
  longitude: 2.34,
  stripeAccountId: null,
  stripeChargesEnabled: false,
  splash360Live: false,
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

const bellaFlatSettings: RestaurantSettingsRecord = {
  pickupEnabled: true,
  deliveryEnabled: true,
  prepMinutes: 20,
  deliveryMinutes: 15,
  slotStepMinutes: 15,
  maxOrdersPerSlot: 2,
  daysAhead: 7,
  deliveryMinimumCents: 1500,
  freeDeliveryThresholdCents: 3500,
  serviceFeeCents: 0,
  openingHours: bellaConfig.schedule.openingHours,
  closures: [],
  zones: [
    { name: 'Moins de 2 km', kind: 'radius', radiusMeters: 2000, postalCodes: [], feeCents: 190 },
  ],
};

/** Mardi 24 novembre 2026, 10:00 à Paris (restaurant pas encore ouvert). */
export const NOW = new Date('2026-11-24T09:00:00.000Z');

export const restaurants: Restaurant[] = [
  restaurant({
    id: BELLA_RESTO,
    tenantId: BELLA_ID,
    name: 'Bella Bastille',
    splash360Id: 'S360-R-BELLA-1',
    latitude: 48.8553,
    longitude: 2.3747,
    stripeAccountId: 'acct_bella',
    stripeChargesEnabled: true,
    splash360Live: false,
  }),
  restaurant({
    id: GREEN_RESTO,
    tenantId: GREEN_ID,
    name: 'Green Bowl Opéra',
    splash360Id: 'S360-R-GREEN-1',
  }),
];

export const JWT_SECRET = 'secret-jwt-supabase-de-test-0123456789abcdef';
export const STAFF_IDS = {
  superAdmin: '20000000-0000-4000-8000-000000000001',
  bellaAdmin: '20000000-0000-4000-8000-000000000002',
  bellaStaff: '20000000-0000-4000-8000-000000000003',
  greenAdmin: '20000000-0000-4000-8000-000000000004',
  bellaManager: '20000000-0000-4000-8000-000000000005',
};

/** Jeton de session Supabase signé pour les tests. */
export async function sessionToken(email: string, secret = JWT_SECRET, expiresIn = '1h') {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`auth-${email}`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

export function testSetup(overrides: Partial<AppDeps> = {}) {
  const backend = createMemoryOrderBackend({ [BELLA_RESTO]: bellaConfig }, () => restaurants);
  const stripe = createFakeGateway();
  // Caisse de démonstration instantanée : prête et confirmée sans délai.
  const pos = createDemoPosGateway({ now: () => NOW, readyAfterMs: 0, confirmAfterMs: 0 });
  const notifications = createFakeNotificationSender();
  const tenants: TenantWithTheme[] = [
    {
      id: BELLA_ID,
      name: 'Pizzeria Bella',
      subdomain: 'bella',
      splash360Id: 'S360-DEMO-BELLA',
      status: 'active',
      applicationFee: { bps: 250, fixedCents: 0 },
      theme: {
        primaryColor: '#C8102E',
        mode: 'light',
        logoUrl: null,
        tagline: 'Napolitaine',
        style: DEFAULT_STYLE,
        loyaltyColor: null,
      },
    },
    {
      id: GREEN_ID,
      name: 'Green Bowl',
      subdomain: 'greenbowl',
      splash360Id: 'S360-DEMO-GREEN',
      status: 'active',
      applicationFee: { bps: 0, fixedCents: 0 },
      theme: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Suspendue',
      subdomain: 'suspendue',
      splash360Id: 'S360-DEMO-SUSPENDED',
      status: 'suspended',
      applicationFee: { bps: 0, fixedCents: 0 },
      theme: null,
    },
  ];
  const admin = createMemoryAdminStore({
    tenants,
    orders: () => backend.orders,
    settings: { [BELLA_RESTO]: bellaFlatSettings },
    staff: [
      {
        id: STAFF_IDS.superAdmin,
        email: 'admin@splash360.test',
        name: 'Super',
        role: 'super_admin',
        tenantId: null,
        restaurantId: null,
      },
      {
        id: STAFF_IDS.bellaAdmin,
        email: 'gerant@bella.test',
        name: 'Gérant',
        role: 'tenant_admin',
        tenantId: BELLA_ID,
        restaurantId: null,
      },
      {
        id: STAFF_IDS.bellaManager,
        email: 'manager@bella.test',
        name: 'Gérant (rôle manager)',
        role: 'manager',
        tenantId: BELLA_ID,
        restaurantId: null,
      },
      {
        id: STAFF_IDS.bellaStaff,
        email: 'equipe@bella.test',
        name: 'Équipe',
        role: 'staff',
        tenantId: BELLA_ID,
        restaurantId: BELLA_RESTO,
      },
      {
        id: STAFF_IDS.greenAdmin,
        email: 'gerant@greenbowl.test',
        name: 'Gérant Green',
        role: 'tenant_admin',
        tenantId: GREEN_ID,
        restaurantId: null,
      },
    ],
  });
  const deps: AppDeps = {
    tenants: createMemoryTenantStore(tenants),
    admin: admin.store,
    promos: backend.promoAdmin,
    ambassador: createMemoryAmbassadorStore({
      [BELLA_ID]: { enabled: true, instagramHandle: 'pizzeriabella', bonusPoints: 50 },
    }),
    verifier: createSupabaseVerifier({ secret: JWT_SECRET }),
    restaurants: createMemoryRestaurantStore(restaurants),
    menus: createMenuCache(createDemoMenuProvider(), { ttlMs: 60_000, maxStaleMs: 0 }),
    ordering: backend.ordering,
    payments: backend.payments,
    orders: backend.reader,
    gateway: stripe.gateway,
    tokenSecret: TOKEN_SECRET,
    operations: backend.operations,
    pos,
    tickets: backend.tickets,
    posInlineWaitMs: 0,
    notifier: notifications.sender,
    posWebhookSecret: POS_SECRET,
    geo: createDemoGeoProvider(),
    now: () => NOW,
    ...overrides,
  };
  return {
    app: asCurrentBackOffice(createApp(deps)),
    backend,
    stripe,
    pos,
    notifications,
    deps,
    admin,
  };
}

/** Les tests parlent au back-office comme sa version actuelle (en-tête X-Splash360-Client). */
function asCurrentBackOffice<T extends { request: (...args: never[]) => unknown }>(app: T): T {
  const original = (app.request as (input: string, init?: RequestInit) => unknown).bind(app);
  const request = (input: string, init: RequestInit = {}) => {
    if (!String(input).startsWith('/v1/admin')) return original(input, init);
    const headers = new Headers(init.headers);
    if (!headers.has('X-Splash360-Client')) headers.set('X-Splash360-Client', 'back-office-2');
    return original(input, { ...init, headers });
  };
  return Object.assign(app, { request });
}

export const testApp = (overrides: Partial<AppDeps> = {}) => testSetup(overrides).app;
