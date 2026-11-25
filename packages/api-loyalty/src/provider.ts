import type { LoyaltyReward } from '@splash360/core';

/** Enseigne vue par Splash360. */
export interface LoyaltyTenant {
  readonly id: string;
  readonly splash360Id: string;
}

/** Programme de fidélité d'une enseigne, défini dans Splash360. */
export interface LoyaltyProgram {
  readonly name: string;
  readonly pointsPerEuro: number;
  readonly welcomePoints: number;
  readonly rewards: readonly LoyaltyReward[];
}

export interface LoyaltyMember {
  readonly id: string;
  readonly name: string;
  /** null : compte créé avec le seul téléphone. */
  readonly email: string | null;
  /** Mobile au format international E.164 (+33…), ou null. */
  readonly phone: string | null;
  readonly points: number;
  /** Contenu du QR code présenté en caisse. */
  readonly cardCode: string;
  /** Date de naissance AAAA-MM-JJ, facultative (lot 16). */
  readonly birthDate: string | null;
}

/** Profil complété par le membre (lot 16) : champ absent inchangé, null pour l'effacer. */
export interface MemberProfileUpdate {
  readonly name?: string;
  readonly email?: string | null;
  readonly birthDate?: string | null;
}

export type ProfileResult =
  | { readonly ok: true; readonly member: LoyaltyMember }
  | { readonly ok: false; readonly error: 'unknown_member' | 'email_taken' };

/** Membre vu depuis le back-office. */
export interface LoyaltyMemberSummary extends LoyaltyMember {
  readonly createdAt: string;
}

export type AdjustResult =
  | { readonly ok: true; readonly member: LoyaltyMember }
  | { readonly ok: false; readonly error: 'unknown_member' | 'insufficient_points' };

export interface LoyaltyMovement {
  /** adjust : correction manuelle depuis le back-office. */
  readonly kind: 'welcome' | 'earn' | 'redeem' | 'adjust';
  /** Positif pour un gain, négatif pour une récompense. */
  readonly points: number;
  readonly label: string;
  readonly at: string;
}

export interface OrderSettlement {
  readonly memberId: string;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly earnPoints: number;
  readonly reward: {
    readonly id: string;
    readonly name: string;
    readonly costPoints: number;
  } | null;
}

export type SettleResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'unknown_member' | 'insufficient_points' };

/**
 * Programme de fidélité. L'implémentation réelle appellera l'API fidélité Splash360
 * (en attente) ; un fournisseur de démonstration sert en attendant (ADR 0009).
 * Seul ce paquet parle à cette API.
 */
export interface LoyaltyProvider {
  /** null : l'enseigne n'a pas de programme de fidélité. */
  getProgram(tenant: LoyaltyTenant): Promise<LoyaltyProgram | null>;
  /**
   * Crée le compte (points de bienvenue) ou retrouve celui de ce téléphone ou de cet e-mail.
   * Il faut au moins l'un des deux ; le téléphone est au format E.164.
   */
  join(
    tenant: LoyaltyTenant,
    input: {
      readonly name: string;
      readonly email: string | null;
      readonly phone: string | null;
    },
  ): Promise<{ readonly member: LoyaltyMember; readonly created: boolean }>;
  findByEmail(tenant: LoyaltyTenant, email: string): Promise<LoyaltyMember | null>;
  /** Client reconnu par son mobile (E.164), l'identifiant principal en caisse. */
  findByPhone(tenant: LoyaltyTenant, phone: string): Promise<LoyaltyMember | null>;
  getMember(tenant: LoyaltyTenant, memberId: string): Promise<LoyaltyMember | null>;
  /** Le membre complète ou corrige son profil (prénom, e-mail, date de naissance). */
  updateProfile(
    tenant: LoyaltyTenant,
    memberId: string,
    input: MemberProfileUpdate,
  ): Promise<ProfileResult>;
  history(tenant: LoyaltyTenant, memberId: string): Promise<readonly LoyaltyMovement[]>;
  /**
   * Commande payée : crédite les points et consomme la récompense, une seule fois par commande
   * (un rejeu ne change rien).
   */
  settleOrder(tenant: LoyaltyTenant, settlement: OrderSettlement): Promise<SettleResult>;

  // ——— Administration (back-office de l'enseigne) ———
  /** Membres les plus récents d'abord ; `search` filtre sur le nom, l'e-mail, le téléphone ou le code de carte. */
  listMembers(
    tenant: LoyaltyTenant,
    search: string | null,
    limit: number,
  ): Promise<readonly LoyaltyMemberSummary[]>;
  /** Ajout (delta > 0) ou retrait (delta < 0) manuel ; le solde ne peut pas devenir négatif. */
  adjustPoints(
    tenant: LoyaltyTenant,
    memberId: string,
    delta: number,
    label: string,
  ): Promise<AdjustResult>;
  /** Droit à l'effacement : le compte et son historique disparaissent. */
  deleteMember(tenant: LoyaltyTenant, memberId: string): Promise<boolean>;
}
