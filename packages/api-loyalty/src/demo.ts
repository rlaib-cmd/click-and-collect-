import type {
  LoyaltyMember,
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
        { id: 'rw-bb-frites', name: 'Frites', costPoints: 400, productId: 'bb-frites' },
        { id: 'rw-bb-boisson', name: 'Boisson', costPoints: 500, productId: 'bb-pepsi' },
        { id: 'rw-bb-burger', name: 'Bills Original', costPoints: 900, productId: 'bb-original' },
        { id: 'rw-bb-tasty', name: 'Bill’s Tasty', costPoints: 1600, productId: 'bb-tasty' },
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
        { id: 'rw-cs-frites', name: 'Frites', costPoints: 300, productId: 'p-frites' },
        { id: 'rw-cs-cola', name: 'Cola 33 cl', costPoints: 300, productId: 'p-cola' },
        { id: 'rw-cs-tenders', name: 'Tenders', costPoints: 700, productId: 'p-tenders' },
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
      readonly email: string;
      readonly phone: string | null;
      readonly cardCode: string;
      readonly welcomePoints: number;
    },
  ): Promise<{ readonly member: LoyaltyMember; readonly created: boolean }>;
  findByEmail(tenantId: string, email: string): Promise<LoyaltyMember | null>;
  getMember(tenantId: string, memberId: string): Promise<LoyaltyMember | null>;
  history(tenantId: string, memberId: string): Promise<LoyaltyMovement[]>;
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
      return store.createMember(tenant.id, {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone,
        cardCode: newCardCode(random),
        welcomePoints: program.welcomePoints,
      });
    },
    findByEmail: (tenant, email) => store.findByEmail(tenant.id, email.trim().toLowerCase()),
    getMember: (tenant, memberId) => store.getMember(tenant.id, memberId),
    history: (tenant, memberId) => store.history(tenant.id, memberId),
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
    movements: (LoyaltyMovement & { orderId: string | null })[];
  }
  const members: Row[] = [];
  let seq = 0;
  const pub = (r: Row): LoyaltyMember => ({
    id: r.id,
    name: r.name,
    email: r.email,
    points: r.points,
    cardCode: r.cardCode,
  });
  const find = (tenantId: string, id: string) =>
    members.find((m) => m.tenantId === tenantId && m.id === id);
  return {
    createMember(tenantId, input) {
      const existing = members.find((m) => m.tenantId === tenantId && m.email === input.email);
      if (existing) return Promise.resolve({ member: pub(existing), created: false });
      seq += 1;
      const row: Row = {
        tenantId,
        id: `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`,
        name: input.name,
        email: input.email,
        points: input.welcomePoints,
        cardCode: input.cardCode,
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
  };
}
