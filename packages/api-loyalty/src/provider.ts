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
  readonly email: string;
  readonly points: number;
  /** Contenu du QR code présenté en caisse. */
  readonly cardCode: string;
}

export interface LoyaltyMovement {
  readonly kind: 'welcome' | 'earn' | 'redeem';
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
  /** Crée le compte (points de bienvenue) ou retrouve celui de cet e-mail. */
  join(
    tenant: LoyaltyTenant,
    input: { readonly name: string; readonly email: string; readonly phone: string | null },
  ): Promise<{ readonly member: LoyaltyMember; readonly created: boolean }>;
  findByEmail(tenant: LoyaltyTenant, email: string): Promise<LoyaltyMember | null>;
  getMember(tenant: LoyaltyTenant, memberId: string): Promise<LoyaltyMember | null>;
  history(tenant: LoyaltyTenant, memberId: string): Promise<readonly LoyaltyMovement[]>;
  /**
   * Commande payée : crédite les points et consomme la récompense, une seule fois par commande
   * (un rejeu ne change rien).
   */
  settleOrder(tenant: LoyaltyTenant, settlement: OrderSettlement): Promise<SettleResult>;
}
