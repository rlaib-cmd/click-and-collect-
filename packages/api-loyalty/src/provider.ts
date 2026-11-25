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
  /**
   * Origine du programme (lot 21, ADR 0026) : « youfid » quand il vient de l'API fidélité
   * Splash360 (points par euro et bienvenue réglés par l'enseigne, historique limité aux
   * opérations faites par l'application) ; absent ou « demo » sinon.
   */
  readonly source?: 'demo' | 'youfid';
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
  | {
      readonly ok: false;
      readonly error:
        | 'unknown_member'
        | 'insufficient_points'
        /** Retrait de points : non pris en charge par YouFID (lot 21). */
        | 'unsupported'
        /** YouFID : nombre de passages par jour atteint (`maximum_scans_reached`). */
        | 'daily_limit'
        /** Opération déjà faite, en cours ou à vérifier (registre local, lot 21). */
        | 'already_processed'
        /** Refus ou panne du fournisseur ; une issue inconnue est à vérifier au back-office. */
        | 'provider_error';
    };

/** Options d'un ajustement (lot 21) : clé d'opération pour ne créditer qu'une fois. */
export interface AdjustOptions {
  /** Clé unique de l'opération (ex. « ambassador:<participation> ») ; un rejeu ne crédite pas. */
  readonly operationKey?: string;
  /** « bonus » : crédit automatique (Ambassadeur) ; « adjust » (défaut) : correction manuelle. */
  readonly kind?: 'adjust' | 'bonus';
}

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
  /** Estimation selon le programme (points par euro) ; YouFID calcule lui-même à partir du montant. */
  readonly earnPoints: number;
  /** Montant payé en centimes, base du gain chez YouFID (lot 21). */
  readonly amountCents: number;
  readonly reward: {
    readonly id: string;
    readonly name: string;
    readonly costPoints: number;
  } | null;
}

export type SettleResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | 'unknown_member'
        | 'insufficient_points'
        /** Même opération en cours ailleurs (appel concurrent). */
        | 'in_progress'
        /** Issue inconnue (panne réseau après envoi) : à vérifier, jamais rejouée seule. */
        | 'uncertain'
        | 'daily_limit'
        | 'provider_error';
    };

/**
 * Fonction non prise en charge par le fournisseur (ex. inscription sans téléphone chez YouFID).
 * Le message est destiné au journal ; la route renvoie son propre texte.
 */
export class LoyaltyUnsupportedError extends Error {
  constructor(readonly reason: 'phone_required') {
    super(`Fidélité : opération non prise en charge (${reason})`);
    this.name = 'LoyaltyUnsupportedError';
  }
}

/**
 * Programme de fidélité. Deux implémentations : l'API fidélité YouFID de Splash360 (lot 21,
 * ADR 0026) pour les enseignes configurées, et le fournisseur de démonstration (ADR 0009) pour
 * les autres, les tests et le développement local. Seul ce paquet parle à l'API fidélité.
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
  /**
   * Ajout (delta > 0) ou retrait (delta < 0) manuel ; le solde ne peut pas devenir négatif.
   * YouFID : ajout seulement (retrait refusé, « unsupported »).
   */
  adjustPoints(
    tenant: LoyaltyTenant,
    memberId: string,
    delta: number,
    label: string,
    options?: AdjustOptions,
  ): Promise<AdjustResult>;
  /**
   * Droit à l'effacement : le compte et son historique disparaissent. YouFID : seul le lien
   * local est effacé ; l'effacement chez YouFID se demande à Splash360 (ADR 0026).
   */
  deleteMember(tenant: LoyaltyTenant, memberId: string): Promise<boolean>;
}
