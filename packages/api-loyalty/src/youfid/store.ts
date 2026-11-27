/**
 * Données locales du fournisseur YouFID (lot 21, ADR 0026), en Postgres dans `@splash360/db`
 * (tables `loyalty_members_youfid`, `loyalty_operations`, `loyalty_program_settings`) et en
 * mémoire pour les tests.
 */

/**
 * Lien entre un client YouFID et l'application. YouFID ne retrouve un client que par QR code ou
 * e-mail (route 3) : le lien garde le QR code de chaque `usr_id`. E-mail et date de naissance sont
 * la copie de ce que le membre a saisi dans l'application (la route 3 ne les renvoie pas).
 */
export interface YoufidMemberLink {
  readonly usrId: string;
  readonly qrCode: string;
  /** E.164, ou null si inconnu (client retrouvé par une recherche du back-office). */
  readonly phone: string | null;
  readonly email: string | null;
  /** Prénom saisi dans l'application (YouFID ne l'enregistre pas toujours, route 12). */
  readonly firstName: string | null;
  readonly birthDate: string | null;
  readonly createdAt: string;
}

export type LoyaltyOperationKind = 'earn' | 'redeem' | 'welcome' | 'bonus' | 'adjust';

/**
 * pending : réservée, appel en cours ; done : appliquée ; failed : refusée (peut être retentée) ;
 * uncertain : issue inconnue, à vérifier à la main (jamais retentée seule) ; resolved : vérifiée.
 */
export type LoyaltyOperationStatus = 'pending' | 'done' | 'failed' | 'uncertain' | 'resolved';

/** Opération de points faite par l'application (registre local, sans donnée personnelle). */
export interface LoyaltyOperation {
  readonly id: string;
  readonly key: string;
  readonly kind: LoyaltyOperationKind;
  readonly memberId: string;
  readonly orderId: string | null;
  /** Points demandés : positif pour un gain (estimation pour « earn »), négatif pour un cadeau. */
  readonly points: number;
  readonly label: string;
  readonly status: LoyaltyOperationStatus;
  /** Code d'erreur court (ex. daily_limit, network), sans donnée client. */
  readonly error: string | null;
  /** Points réellement crédités d'après YouFID (`won_pts`), si connus. */
  readonly responsePoints: number | null;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewLoyaltyOperation {
  readonly key: string;
  readonly kind: LoyaltyOperationKind;
  readonly memberId: string;
  readonly orderId: string | null;
  readonly points: number;
  readonly label: string;
}

/**
 * Réglages du programme que l'API ne fournit pas (lot 21) : défauts décidés par Splash360 le
 * 25/11 (1 € = 10 points, 100 points de bienvenue), modifiables par enseigne au back-office.
 */
export interface LoyaltyProgramSettings {
  readonly pointsPerEuro: number;
  readonly welcomePoints: number;
}

export const DEFAULT_PROGRAM_SETTINGS: LoyaltyProgramSettings = {
  pointsPerEuro: 1,
  welcomePoints: 100,
};

export interface YoufidStore {
  /** Crée ou met à jour le lien ; un téléphone null garde celui déjà connu. */
  saveLink(
    tenantId: string,
    link: { readonly usrId: string; readonly qrCode: string; readonly phone: string | null },
  ): Promise<YoufidMemberLink>;
  getLink(tenantId: string, usrId: string): Promise<YoufidMemberLink | null>;
  /** Lien le plus récent pour ce téléphone (E.164). */
  findLinkByPhone(tenantId: string, phone: string): Promise<YoufidMemberLink | null>;
  /** Liens les plus récents d'abord. */
  listLinks(tenantId: string, limit: number): Promise<YoufidMemberLink[]>;
  /** Champ absent : inchangé ; null : effacé. */
  updateLinkProfile(
    tenantId: string,
    usrId: string,
    input: {
      readonly email?: string | null;
      readonly birthDate?: string | null;
      readonly firstName?: string | null;
    },
  ): Promise<void>;
  deleteLink(tenantId: string, usrId: string): Promise<boolean>;

  /**
   * Réserve l'opération (insertion conditionnelle sur la clé unique). `claimed` : à exécuter ;
   * sinon l'opération existante est renvoyée telle quelle. Une opération « failed » est reprise.
   */
  claimOperation(
    tenantId: string,
    op: NewLoyaltyOperation,
  ): Promise<{ readonly claimed: boolean; readonly operation: LoyaltyOperation }>;
  finishOperation(
    tenantId: string,
    key: string,
    outcome: {
      readonly status: 'done' | 'failed' | 'uncertain';
      readonly responsePoints?: number | null;
      readonly error?: string | null;
    },
  ): Promise<void>;
  /** pending réservée avant `before` (serveur arrêté en plein appel) → uncertain. */
  markStale(tenantId: string, key: string, before: Date): Promise<boolean>;
  memberOperations(tenantId: string, memberId: string, limit: number): Promise<LoyaltyOperation[]>;
  /** Opérations failed et uncertain, les plus récentes d'abord. */
  operationsToReview(tenantId: string, limit: number): Promise<LoyaltyOperation[]>;
  /** uncertain ou failed → resolved (vérifiée à la main). */
  resolveOperation(tenantId: string, id: string): Promise<boolean>;

  getProgramSettings(tenantId: string): Promise<LoyaltyProgramSettings>;
  saveProgramSettings(tenantId: string, settings: LoyaltyProgramSettings): Promise<void>;
}

/** Stockage en mémoire, même comportement que la version Postgres (tests). */
export function createMemoryYoufidStore(now: () => Date = () => new Date()): YoufidStore {
  interface Link extends YoufidMemberLink {
    tenantId: string;
    seq: number;
  }
  interface Op extends LoyaltyOperation {
    tenantId: string;
    seq: number;
  }
  let links: Link[] = [];
  const ops: Op[] = [];
  const settings = new Map<string, LoyaltyProgramSettings>();
  let seq = 0;
  const pubLink = ({ tenantId: _t, seq: _s, ...l }: Link): YoufidMemberLink => l;
  const pubOp = ({ tenantId: _t, seq: _s, ...o }: Op): LoyaltyOperation => o;
  const byRecent = <T extends { seq: number }>(a: T, b: T) => b.seq - a.seq;
  const findOp = (tenantId: string, key: string) =>
    ops.findIndex((o) => o.tenantId === tenantId && o.key === key);
  const replace = (i: number, patch: Partial<Op>) => {
    const old = ops[i];
    if (old) ops[i] = { ...old, ...patch, updatedAt: now().toISOString() };
  };

  return {
    saveLink(tenantId, link) {
      seq += 1;
      const i = links.findIndex((l) => l.tenantId === tenantId && l.usrId === link.usrId);
      const old = links[i];
      const next: Link = old
        ? { ...old, qrCode: link.qrCode, phone: link.phone ?? old.phone }
        : {
            tenantId,
            seq,
            usrId: link.usrId,
            qrCode: link.qrCode,
            phone: link.phone,
            email: null,
            firstName: null,
            birthDate: null,
            createdAt: now().toISOString(),
          };
      if (old) links[i] = next;
      else links.push(next);
      return Promise.resolve(pubLink(next));
    },
    getLink(tenantId, usrId) {
      const l = links.find((x) => x.tenantId === tenantId && x.usrId === usrId);
      return Promise.resolve(l ? pubLink(l) : null);
    },
    findLinkByPhone(tenantId, phone) {
      const l = links.filter((x) => x.tenantId === tenantId && x.phone === phone).sort(byRecent)[0];
      return Promise.resolve(l ? pubLink(l) : null);
    },
    listLinks(tenantId, limit) {
      return Promise.resolve(
        links
          .filter((x) => x.tenantId === tenantId)
          .sort(byRecent)
          .slice(0, limit)
          .map(pubLink),
      );
    },
    updateLinkProfile(tenantId, usrId, input) {
      links = links.map((l) =>
        l.tenantId === tenantId && l.usrId === usrId
          ? {
              ...l,
              ...(input.email !== undefined ? { email: input.email } : {}),
              ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
              ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
            }
          : l,
      );
      return Promise.resolve();
    },
    deleteLink(tenantId, usrId) {
      const before = links.length;
      links = links.filter((l) => !(l.tenantId === tenantId && l.usrId === usrId));
      return Promise.resolve(links.length < before);
    },

    claimOperation(tenantId, op) {
      const i = findOp(tenantId, op.key);
      const existing = ops[i];
      if (existing) {
        if (existing.status !== 'failed') {
          return Promise.resolve({ claimed: false, operation: pubOp(existing) });
        }
        replace(i, { status: 'pending', attempts: existing.attempts + 1, error: null });
        const again = ops[i];
        return Promise.resolve({ claimed: true, operation: pubOp(again ?? existing) });
      }
      seq += 1;
      const at = now().toISOString();
      const row: Op = {
        ...op,
        tenantId,
        seq,
        id: `00000000-0000-4000-a000-${String(seq).padStart(12, '0')}`,
        status: 'pending',
        error: null,
        responsePoints: null,
        attempts: 1,
        createdAt: at,
        updatedAt: at,
      };
      ops.push(row);
      return Promise.resolve({ claimed: true, operation: pubOp(row) });
    },
    finishOperation(tenantId, key, outcome) {
      const i = findOp(tenantId, key);
      if (i >= 0 && ops[i]?.status === 'pending') {
        replace(i, {
          status: outcome.status,
          responsePoints: outcome.responsePoints ?? null,
          error: outcome.error ?? null,
        });
      }
      return Promise.resolve();
    },
    markStale(tenantId, key, before) {
      const i = findOp(tenantId, key);
      const op = ops[i];
      if (!op || op.status !== 'pending' || Date.parse(op.updatedAt) >= before.getTime()) {
        return Promise.resolve(false);
      }
      replace(i, { status: 'uncertain', error: 'interrupted' });
      return Promise.resolve(true);
    },
    memberOperations(tenantId, memberId, limit) {
      return Promise.resolve(
        ops
          .filter((o) => o.tenantId === tenantId && o.memberId === memberId)
          .sort(byRecent)
          .slice(0, limit)
          .map(pubOp),
      );
    },
    operationsToReview(tenantId, limit) {
      return Promise.resolve(
        ops
          .filter(
            (o) => o.tenantId === tenantId && (o.status === 'failed' || o.status === 'uncertain'),
          )
          .sort(byRecent)
          .slice(0, limit)
          .map(pubOp),
      );
    },
    resolveOperation(tenantId, id) {
      const i = ops.findIndex(
        (o) =>
          o.tenantId === tenantId &&
          o.id === id &&
          (o.status === 'failed' || o.status === 'uncertain'),
      );
      if (i >= 0) replace(i, { status: 'resolved' });
      return Promise.resolve(i >= 0);
    },

    getProgramSettings(tenantId) {
      return Promise.resolve(settings.get(tenantId) ?? DEFAULT_PROGRAM_SETTINGS);
    },
    saveProgramSettings(tenantId, s) {
      settings.set(tenantId, s);
      return Promise.resolve();
    },
  };
}
