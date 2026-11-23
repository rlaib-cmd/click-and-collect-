import { normalizeFrenchPhone } from '@splash360/core';
import type {
  AdjustResult,
  LoyaltyMember,
  LoyaltyMemberSummary,
  LoyaltyMovement,
  LoyaltyProgram,
  LoyaltyProvider,
  SettleResult,
} from './provider';

/**
 * Programmes de démonstration, repris de l'app fidélité Bills Burger (10 points par euro,
 * 100 points de bienvenue). Les récompenses pointent vers des produits des cartes de démonstration.
 */
export const DEMO_LOYALTY_PROGRAMS: ReadonlyMap<string, LoyaltyProgram> = new Map([
  [
    'S360-DEMO-BILLS',
    {
      name: 'Le club Bill’s Burger',
      pointsPerEuro: 10,
      welcomePoints: 100,
      rewards: [
        {
          id: 'rw-bb-frites',
          name: 'Un side offert',
          costPoints: 400,
          productIds: ['bb-frites', 'bb-frites-cajun', 'bb-patates-douces'],
        },
        {
          id: 'rw-bb-boisson',
          name: 'Une boisson ou un cookie',
          costPoints: 500,
          productIds: [
            'bb-pepsi',
            'bb-pepsi-cherry',
            'bb-cookie-blanc',
            'bb-cookie-lait',
            'bb-cookie-brownie',
          ],
        },
        {
          id: 'rw-bb-burger',
          name: 'Un smash burger',
          costPoints: 900,
          productIds: [
            'bb-original',
            'bb-smoke',
            'bb-frenchy',
            'bb-farmer',
            'bb-honey',
            'bb-crispy',
          ],
        },
        {
          id: 'rw-bb-tasty',
          name: 'Un bon plan',
          costPoints: 1600,
          productIds: ['bb-tasty', 'bb-tasty-golden'],
        },
      ],
    },
  ],
  [
    'S360-DEMO-CHICKEN',
    {
      name: 'Chicken Street Club',
      pointsPerEuro: 10,
      welcomePoints: 100,
      rewards: [
        {
          id: 'rw-cs-petit',
          name: 'Frites ou boisson',
          costPoints: 300,
          productIds: ['p-frites', 'p-cola'],
        },
        { id: 'rw-cs-tenders', name: 'Tenders', costPoints: 700, productIds: ['p-tenders'] },
      ],
    },
  ],
]);

/** Stockage des données de test (Postgres dans `@splash360/db`, mémoire pour les tests). */
export interface DemoLoyaltyStore {
  createMember(
    tenantId: string,
    input: {
      readonly name: string;
      readonly email: string | null;
      readonly phone: string | null;
      readonly cardCode: string;
      readonly welcomePoints: number;
    },
  ): Promise<{ readonly member: LoyaltyMember; readonly created: boolean }>;
  findByEmail(tenantId: string, email: string): Promise<LoyaltyMember | null>;
  findByPhone(tenantId: string, phone: string): Promise<LoyaltyMember | null>;
  getMember(tenantId: string, memberId: string): Promise<LoyaltyMember | null>;
  history(tenantId: string, memberId: string): Promise<LoyaltyMovement[]>;
  listMembers(
    tenantId: string,
    search: string | null,
    limit: number,
  ): Promise<LoyaltyMemberSummary[]>;
  adjust(tenantId: string, memberId: string, delta: number, label: string): Promise<AdjustResult>;
  deleteMember(tenantId: string, memberId: string): Promise<boolean>;
  settle(
    tenantId: string,
    input: {
      readonly memberId: string;
      readonly orderId: string;
      readonly earn: { readonly points: number; readonly label: string } | null;
      readonly redeem: { readonly points: number; readonly label: string } | null;
    },
  ): Promise<SettleResult>;
}

/** Code de carte imprimable dans un QR code : préfixe de l'enseigne et 12 caractères aléatoires. */
function newCardCode(random: () => string): string {
  return `S360-${random()
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 12)}`;
}

export function createDemoLoyaltyProvider(
  store: DemoLoyaltyStore,
  /** Générateur d'identifiants aléatoires (randomUUID côté serveur). */
  random: () => string,
  /** Programmes par identifiant Splash360 de l'enseigne. */
  programs: ReadonlyMap<string, LoyaltyProgram> = DEMO_LOYALTY_PROGRAMS,
): LoyaltyProvider {
  return {
    getProgram: (tenant) => Promise.resolve(programs.get(tenant.splash360Id) ?? null),
    async join(tenant, input) {
      const program = programs.get(tenant.splash360Id);
      if (!program) throw new Error('Pas de programme de fidélité pour cette enseigne');
      if (!input.email && !input.phone) throw new Error('Téléphone ou e-mail requis');
      return store.createMember(tenant.id, {
        name: input.name.trim(),
        email: input.email ? input.email.trim().toLowerCase() : null,
        phone: input.phone,
        cardCode: newCardCode(random),
        welcomePoints: program.welcomePoints,
      });
    },
    findByEmail: (tenant, email) => store.findByEmail(tenant.id, email.trim().toLowerCase()),
    findByPhone: (tenant, phone) => store.findByPhone(tenant.id, phone),
    getMember: (tenant, memberId) => store.getMember(tenant.id, memberId),
    history: (tenant, memberId) => store.history(tenant.id, memberId),
    listMembers: (tenant, search, limit) => {
      const q = search?.trim().toLowerCase() || null;
      // « 06 12 34… » se cherche au format enregistré (+33612…).
      return store.listMembers(tenant.id, (q && normalizeFrenchPhone(q)) ?? q, limit);
    },
    async adjustPoints(tenant, memberId, delta, label) {
      if (!Number.isInteger(delta) || delta === 0) throw new Error('Ajustement invalide');
      return store.adjust(tenant.id, memberId, delta, label.trim());
    },
    deleteMember: (tenant, memberId) => store.deleteMember(tenant.id, memberId),
    settleOrder: (tenant, s) =>
      store.settle(tenant.id, {
        memberId: s.memberId,
        orderId: s.orderId,
        earn:
          s.earnPoints > 0 ? { points: s.earnPoints, label: `Commande n° ${s.orderNumber}` } : null,
        redeem: s.reward
          ? { points: s.reward.costPoints, label: `Récompense : ${s.reward.name}` }
          : null,
      }),
  };
}

/** Stockage en mémoire, même comportement que la version Postgres (tests). */
export function createMemoryDemoLoyaltyStore(now: () => Date = () => new Date()): DemoLoyaltyStore {
  interface Row extends Omit<LoyaltyMember, 'points'> {
    tenantId: string;
    points: number;
    createdAt: string;
    movements: (LoyaltyMovement & { orderId: string | null })[];
  }
  const members: Row[] = [];
  let seq = 0;
  const pub = (r: Row): LoyaltyMember => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    points: r.points,
    cardCode: r.cardCode,
  });
  const find = (tenantId: string, id: string) =>
    members.find((m) => m.tenantId === tenantId && m.id === id);
  return {
    createMember(tenantId, input) {
      const existing = members.find(
        (m) =>
          m.tenantId === tenantId &&
          ((input.phone !== null && m.phone === input.phone) ||
            (input.email !== null && m.email === input.email)),
      );
      if (existing) return Promise.resolve({ member: pub(existing), created: false });
      seq += 1;
      const row: Row = {
        tenantId,
        id: `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`,
        name: input.name,
        email: input.email,
        phone: input.phone,
        points: input.welcomePoints,
        cardCode: input.cardCode,
        createdAt: now().toISOString(),
        movements: [],
      };
      if (input.welcomePoints > 0) {
        row.movements.push({
          kind: 'welcome',
          points: input.welcomePoints,
          label: 'Points de bienvenue',
          at: now().toISOString(),
          orderId: null,
        });
      }
      members.push(row);
      return Promise.resolve({ member: pub(row), created: true });
    },
    findByEmail(tenantId, email) {
      const r = members.find((m) => m.tenantId === tenantId && m.email === email);
      return Promise.resolve(r ? pub(r) : null);
    },
    findByPhone(tenantId, phone) {
      const r = members.find((m) => m.tenantId === tenantId && m.phone === phone);
      return Promise.resolve(r ? pub(r) : null);
    },
    getMember(tenantId, memberId) {
      const r = find(tenantId, memberId);
      return Promise.resolve(r ? pub(r) : null);
    },
    history(tenantId, memberId) {
      const r = find(tenantId, memberId);
      return Promise.resolve(
        r
          ? [...r.movements]
              .reverse()
              .map(({ kind, points, label, at }) => ({ kind, points, label, at }))
          : [],
      );
    },
    settle(tenantId, input) {
      const r = find(tenantId, input.memberId);
      if (!r) return Promise.resolve({ ok: false, error: 'unknown_member' });
      const done = (kind: LoyaltyMovement['kind']) =>
        r.movements.some((m) => m.kind === kind && m.orderId === input.orderId);
      const redeem = input.redeem && !done('redeem') ? input.redeem : null;
      if (redeem && r.points < redeem.points) {
        return Promise.resolve({ ok: false, error: 'insufficient_points' });
      }
      const at = now().toISOString();
      if (redeem) {
        r.points -= redeem.points;
        r.movements.push({
          kind: 'redeem',
          points: -redeem.points,
          label: redeem.label,
          at,
          orderId: input.orderId,
        });
      }
      if (input.earn && !done('earn')) {
        r.points += input.earn.points;
        r.movements.push({
          kind: 'earn',
          points: input.earn.points,
          label: input.earn.label,
          at,
          orderId: input.orderId,
        });
      }
      return Promise.resolve({ ok: true });
    },
    listMembers(tenantId, search, limit) {
      const match = (m: Row) =>
        !search ||
        [m.name.toLowerCase(), m.email ?? '', m.phone ?? '', m.cardCode.toLowerCase()].some((v) =>
          v.includes(search),
        );
      return Promise.resolve(
        members
          .filter((m) => m.tenantId === tenantId && match(m))
          .reverse()
          .slice(0, limit)
          .map((m) => ({ ...pub(m), createdAt: m.createdAt })),
      );
    },
    adjust(tenantId, memberId, delta, label) {
      const r = find(tenantId, memberId);
      if (!r) return Promise.resolve({ ok: false, error: 'unknown_member' });
      if (r.points + delta < 0) return Promise.resolve({ ok: false, error: 'insufficient_points' });
      r.points += delta;
      r.movements.push({
        kind: 'adjust',
        points: delta,
        label,
        at: now().toISOString(),
        orderId: null,
      });
      return Promise.resolve({ ok: true, member: pub(r) });
    },
    deleteMember(tenantId, memberId) {
      const i = members.findIndex((m) => m.tenantId === tenantId && m.id === memberId);
      if (i >= 0) members.splice(i, 1);
      return Promise.resolve(i >= 0);
    },
  };
}
