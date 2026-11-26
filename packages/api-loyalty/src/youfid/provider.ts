import { normalizeFrenchPhone } from '@splash360/core';
import {
  LoyaltyUnsupportedError,
  type AdjustResult,
  type LoyaltyMember,
  type LoyaltyMemberSummary,
  type LoyaltyMovement,
  type LoyaltyProgram,
  type LoyaltyProvider,
  type LoyaltyTenant,
  type SettleResult,
} from '../provider';
import {
  YoufidError,
  type ProfileQuestionType,
  type YoufidScanRefusal,
  type YoufidClient,
  type YoufidCustomer,
  type YoufidProfileQuestion,
} from './client';
import type { LoyaltyOperationKind, YoufidMemberLink, YoufidStore } from './store';

/**
 * Fournisseur de fidélité branché sur YouFID (lot 21, ADR 0026), pour UNE enseigne (un compte
 * marchand). Correspondances :
 * - programme : route 2 (cadeaux) + réglages locaux (points par euro, bienvenue) ;
 * - inscription et connexion par SMS : route 10 (client retrouvé ou créé par téléphone) ;
 * - membre : route 3 par QR code, retrouvé grâce au lien local `usr_id` → QR code ;
 * - commande payée : route 6 (cadeau) puis route 5 avec le montant (gain), une seule fois grâce au
 *   registre local `loyalty_operations` (l'API n'a pas de clé d'idempotence) ;
 * - bonus et corrections : route 5 avec `forced_amount` (positif seulement) ;
 * - historique : le registre local (opérations faites par l'application uniquement).
 */
export interface YoufidProviderOptions {
  readonly client: YoufidClient;
  readonly store: YoufidStore;
  /** Journal sans donnée personnelle (identifiants techniques et codes d'erreur seulement). */
  readonly log?: (message: string, data?: Record<string, unknown>) => void;
  readonly now?: () => Date;
  /** Identifiant d'opération aléatoire (randomUUID côté serveur). */
  readonly random: () => string;
  /** Nom affiché d'un membre sans prénom, et nom par défaut à ne pas envoyer à YouFID. */
  readonly defaultName?: string;
  /** Durée de cache du programme (route 2). */
  readonly programTtlMs?: number;
}

/** Une opération « pending » plus vieille que ce délai a été interrompue (serveur arrêté). */
export const STALE_OPERATION_MS = 2 * 60_000;
/** Nombre maximal de fiches lues (route 3) pour une page du back-office. */
const ADMIN_LOOKUPS = 20;

const USR_ID = /^\d{1,18}$/;

type RefusalCode =
  | 'unknown_member'
  | 'insufficient_points'
  | 'daily_limit'
  /** Plafond de solde YouFID atteint (`code` MAX_POINTS_REACHED, Splash360 26/11). */
  | 'balance_cap'
  /** Montant refusé par YouFID (`code` AMOUNT_TOO_HIGH). */
  | 'amount_too_high'
  /** Route 6 en erreur (« Problem during withdrawPoints ») : cadeau non déduit. */
  | 'redeem_failed'
  | 'not_credited';

/** Échec certain (rien n'a été appliqué chez YouFID) détecté avant ou pendant l'opération. */
class Refused extends Error {
  constructor(readonly code: RefusalCode) {
    super(code);
  }
}

/** Journal d'un refus : message clair pour l'équipe (visible aussi dans « Opérations à vérifier »). */
const REFUSAL_LOG: Partial<Record<RefusalCode, string>> = {
  daily_limit: 'Fidélité YouFID : nombre de passages du jour atteint',
  balance_cap: 'Fidélité YouFID : plafond de solde atteint, aucun point crédité',
  amount_too_high: 'Fidélité YouFID : montant refusé (trop élevé), aucun point crédité',
  redeem_failed: 'Fidélité YouFID : cadeau refusé par YouFID (route 6), opération à vérifier',
};

type OperationOutcome =
  | { readonly ok: true; readonly points: number | null }
  | {
      readonly ok: false;
      readonly error:
        Exclude<RefusalCode, 'not_credited'> | 'in_progress' | 'uncertain' | 'provider_error';
    };

/** Refus de la route 5 : `code` (MAX_POINTS_REACHED…) puis filet « 0 point crédité ». */
function checkScan(
  r: { readonly refusal: YoufidScanRefusal | null; readonly wonPoints: number },
  requested: number,
): number {
  if (r.refusal) throw new Refused(r.refusal);
  // Aucun point crédité sans code explicite : rien n'a été appliqué, à vérifier.
  if (r.wonPoints === 0 && requested > 0) throw new Refused('not_credited');
  return r.wonPoints;
}

/**
 * Inscription refusée par YouFID : « Duplicated user » (route 10), le téléphone correspond à
 * plusieurs fiches chez YouFID. À régler par l'équipe avec Splash360 ; le client reçoit un message
 * générique (lot 21, réponses du 26/11).
 */
export class LoyaltyDuplicateCustomerError extends Error {
  constructor() {
    super('YouFID : client en double (Duplicated user)');
    this.name = 'LoyaltyDuplicateCustomerError';
  }
}

/**
 * Nom d'un palier YouFID pour l'application : le coût saisi en fin de nom chez YouFID
 * (« Une boisson offerte (30 pts) ») est retiré, l'application l'affiche déjà.
 */
export function rewardLabel(name: string): string {
  const label = name.replace(/\s*\(\s*\d+\s*(?:pts?|points?)\s*\)\s*$/i, '').trim();
  return label || name.trim();
}

export function createYoufidLoyaltyProvider(options: YoufidProviderOptions): LoyaltyProvider {
  const { client, store } = options;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const defaultName = options.defaultName ?? 'Membre';
  const programTtl = options.programTtlMs ?? 60_000;
  let program: { at: number; value: Awaited<ReturnType<YoufidClient['merchantDetails']>> } | null =
    null;

  async function merchant() {
    const t = now().getTime();
    if (program && t - program.at < programTtl) return program.value;
    try {
      const value = await client.merchantDetails();
      program = { at: t, value };
      return value;
    } catch (error) {
      // YouFID indisponible : la dernière version connue sert encore (cadeaux, nom).
      if (program) {
        log('YouFID : programme servi depuis le cache', { error: errorCode(error) });
        return program.value;
      }
      throw error;
    }
  }

  function toMember(c: YoufidCustomer, link: YoufidMemberLink | null): LoyaltyMember {
    const name = [c.firstName, c.lastName]
      .map((v) => v?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    return {
      id: c.usrId,
      name: name || defaultName,
      email: link?.email ?? null,
      phone: (c.phone && normalizeFrenchPhone(c.phone)) ?? link?.phone ?? null,
      points: c.totalPoints,
      cardCode: c.qrCode,
      birthDate: link?.birthDate ?? null,
    };
  }

  /** Lit la fiche YouFID d'un lien et rafraîchit le QR code et le téléphone connus. */
  async function memberOf(link: YoufidMemberLink): Promise<LoyaltyMember | null> {
    const c = await client.findCustomer({ qrCode: link.qrCode });
    if (!c || c.usrId !== link.usrId) return null;
    return toMember(c, link);
  }

  /**
   * Exactement une fois : réserve la clé dans le registre, appelle YouFID, puis note l'issue.
   * Une panne après envoi laisse l'opération « uncertain » : elle n'est jamais rejouée seule et
   * apparaît au back-office pour vérification.
   */
  async function runOperation(
    tenant: LoyaltyTenant,
    op: {
      readonly key: string;
      readonly kind: LoyaltyOperationKind;
      readonly memberId: string;
      readonly orderId: string | null;
      readonly points: number;
      readonly label: string;
    },
    work: (send: <T>(call: () => Promise<T>) => Promise<T>) => Promise<number | null>,
  ): Promise<OperationOutcome> {
    const claim = await store.claimOperation(tenant.id, op);
    if (!claim.claimed) {
      const existing = claim.operation;
      if (existing.status === 'done' || existing.status === 'resolved') {
        return { ok: true, points: existing.responsePoints };
      }
      if (existing.status === 'pending') {
        const stale = await store.markStale(
          tenant.id,
          op.key,
          new Date(now().getTime() - STALE_OPERATION_MS),
        );
        if (stale) {
          log('Fidélité YouFID : opération interrompue, à vérifier', {
            tenantId: tenant.id,
            key: op.key,
          });
          return { ok: false, error: 'uncertain' };
        }
        return { ok: false, error: 'in_progress' };
      }
      return { ok: false, error: 'uncertain' };
    }
    let sent = false;
    const send = <T>(call: () => Promise<T>): Promise<T> => {
      sent = true;
      return call();
    };
    try {
      const points = await work(send);
      await store.finishOperation(tenant.id, op.key, { status: 'done', responsePoints: points });
      return { ok: true, points };
    } catch (error) {
      if (error instanceof Refused) {
        await store.finishOperation(tenant.id, op.key, { status: 'failed', error: error.code });
        const message = REFUSAL_LOG[error.code];
        if (message) log(message, { tenantId: tenant.id, key: op.key });
        if (error.code === 'not_credited') {
          // Visible au back-office (« Opérations à vérifier ») ; rien n'a été crédité, un
          // nouveau règlement ou une correction manuelle peut la reprendre sans doublon.
          log('Fidélité YouFID : aucun point crédité, opération à vérifier', {
            tenantId: tenant.id,
            key: op.key,
          });
          return { ok: false, error: 'provider_error' };
        }
        return { ok: false, error: error.code };
      }
      // Issue inconnue si la requête est partie et que la réponse manque ou est illisible.
      const uncertain = sent && (!(error instanceof YoufidError) || error.uncertain);
      await store.finishOperation(tenant.id, op.key, {
        status: uncertain ? 'uncertain' : 'failed',
        error: errorCode(error),
      });
      log(
        uncertain
          ? 'Fidélité YouFID : issue inconnue, opération à vérifier'
          : 'Fidélité YouFID : opération refusée',
        { tenantId: tenant.id, key: op.key, error: errorCode(error) },
      );
      return { ok: false, error: uncertain ? 'uncertain' : 'provider_error' };
    }
  }

  async function credit(
    tenant: LoyaltyTenant,
    link: YoufidMemberLink,
    op: {
      readonly key: string;
      readonly kind: LoyaltyOperationKind;
      readonly points: number;
      readonly label: string;
    },
  ): Promise<OperationOutcome> {
    return runOperation(tenant, { ...op, memberId: link.usrId, orderId: null }, async (send) => {
      // Bonus, bienvenue, correction : crédit forcé seul, sans montant (Splash360, 26/11).
      const r = await send(() =>
        client.scan({ qrCode: link.qrCode, usrId: link.usrId, forcedPoints: op.points }),
      );
      return checkScan(r, op.points);
    });
  }

  /** Question de profil à envoyer (route 12) ; id de la question en attente si elle correspond. */
  async function submitProfile(
    usrId: string,
    pending: YoufidProfileQuestion | null,
    answers: readonly (readonly [ProfileQuestionType, string])[],
  ): Promise<boolean> {
    let ok = true;
    for (const [type, response] of answers) {
      try {
        // Hypothèse (questions-en-attente, YouFID Y9) : le type suffit ; l'id n'est connu que pour
        // la prochaine question renvoyée par YouFID, sinon 0.
        const id = pending?.type === type ? pending.id : '0';
        await client.submitProfileResponse(usrId, { id, type }, response);
      } catch (error) {
        ok = false;
        log('YouFID : profil non transmis', { field: type, error: errorCode(error) });
      }
    }
    return ok;
  }

  async function linkFor(tenantId: string, memberId: string) {
    return USR_ID.test(memberId) ? store.getLink(tenantId, memberId) : null;
  }

  const provider: LoyaltyProvider = {
    async getProgram(tenant): Promise<LoyaltyProgram> {
      const [m, settings] = await Promise.all([merchant(), store.getProgramSettings(tenant.id)]);
      return {
        name: m.programName?.trim() || m.name?.trim() || 'Club fidélité',
        pointsPerEuro: settings.pointsPerEuro,
        welcomePoints: settings.welcomePoints,
        rewards: m.products
          .filter((p) => p.cost > 0)
          .map((p) => ({
            id: p.id,
            name: rewardLabel(p.name),
            costPoints: p.cost,
            productIds: [],
          })),
        source: 'youfid',
      };
    },

    async join(tenant, input) {
      if (!input.phone) {
        // YouFID ne crée un client que par téléphone (route 10) ; l'e-mail retrouve un client existant.
        const existing = input.email ? await provider.findByEmail(tenant, input.email) : null;
        if (existing) return { member: existing, created: false };
        throw new LoyaltyUnsupportedError('phone_required');
      }
      // Téléphone toujours enregistré au format international (+33…), quel que soit l'appelant.
      const phone = normalizeFrenchPhone(input.phone);
      if (!phone) throw new LoyaltyUnsupportedError('phone_required');
      const reg = await client.registerByPhone(phone).catch((error: unknown) => {
        if (error instanceof YoufidError && error.duplicatedUser) {
          log('YouFID : inscription refusée, client en double (Duplicated user)', {
            tenantId: tenant.id,
          });
          throw new LoyaltyDuplicateCustomerError();
        }
        throw error;
      });
      const created = !reg.existing;
      const link = await store.saveLink(tenant.id, {
        usrId: reg.usrId,
        qrCode: reg.qrCode,
        phone,
      });
      if (created) {
        const answers: [ProfileQuestionType, string][] = [];
        const name = input.name.trim();
        if (name && name !== defaultName) answers.push(['NAME', name]);
        const email = input.email?.trim().toLowerCase();
        if (email) {
          answers.push(['EMAIL', email]);
          await store.updateLinkProfile(tenant.id, reg.usrId, { email });
        }
        await submitProfile(reg.usrId, reg.profileQuestion, answers);
      }
      // Bienvenue à la première adhésion dans l'application de l'enseigne, même pour un client
      // déjà connu de YouFID (décision du propriétaire, 26/11). La clé `welcome:<usr_id>` est
      // gardée même après suppression du compte : une seule bienvenue par client et par enseigne.
      const { welcomePoints } = await store.getProgramSettings(tenant.id);
      if (welcomePoints > 0) {
        const w = await credit(tenant, link, {
          key: `welcome:${reg.usrId}`,
          kind: 'welcome',
          points: welcomePoints,
          label: 'Points de bienvenue',
        });
        if (!w.ok) log('YouFID : points de bienvenue non crédités', { error: w.error });
      }
      const member = await memberOf((await store.getLink(tenant.id, reg.usrId)) ?? link);
      if (!member) throw new YoufidError('Client YouFID introuvable après inscription', 'api');
      return { member, created };
    },

    async findByEmail(tenant, email) {
      const c = await client.findCustomer({ email: email.trim().toLowerCase() });
      if (!c) return null;
      const link = await store.saveLink(tenant.id, {
        usrId: c.usrId,
        qrCode: c.qrCode,
        phone: c.phone ? normalizeFrenchPhone(c.phone) : null,
      });
      return toMember(c, link);
    },

    async findByPhone(tenant, phone) {
      // Seuls les clients déjà liés à l'application : la route 10 crée le client s'il n'existe
      // pas, elle n'est appelée qu'à l'inscription (après acceptation des conditions).
      const link = await store.findLinkByPhone(tenant.id, phone);
      return link ? memberOf(link) : null;
    },

    async getMember(tenant, memberId) {
      const link = await linkFor(tenant.id, memberId);
      return link ? memberOf(link) : null;
    },

    async updateProfile(tenant, memberId, input) {
      const link = await linkFor(tenant.id, memberId);
      if (!link) return { ok: false, error: 'unknown_member' };
      const answers: [ProfileQuestionType, string][] = [];
      const name = input.name?.trim();
      if (name) answers.push(['NAME', name]);
      const email = input.email ? input.email.trim().toLowerCase() : input.email;
      if (email) answers.push(['EMAIL', email]);
      if (input.birthDate) answers.push(['BIRTH', input.birthDate]);
      if (answers.length > 0) {
        // La route 3 renvoie la question de profil en attente (sans passer par la route 11).
        const pending = await client
          .findCustomer({ qrCode: link.qrCode })
          .then((c) => c?.profileQuestion ?? null)
          .catch(() => null);
        await submitProfile(link.usrId, pending, answers);
      }
      // YouFID n'efface pas un champ (réponse vide refusée) : l'effacement reste local.
      await store.updateLinkProfile(tenant.id, link.usrId, {
        ...(email !== undefined ? { email } : {}),
        ...(input.birthDate !== undefined ? { birthDate: input.birthDate } : {}),
      });
      const member = await memberOf((await store.getLink(tenant.id, link.usrId)) ?? link);
      return member ? { ok: true, member } : { ok: false, error: 'unknown_member' };
    },

    async history(tenant, memberId): Promise<LoyaltyMovement[]> {
      const ops = await store.memberOperations(tenant.id, memberId, 50);
      return ops
        .filter((o) => o.status === 'done' || o.status === 'resolved')
        .map((o) => ({
          kind: o.kind === 'bonus' ? 'adjust' : o.kind === 'welcome' ? 'welcome' : o.kind,
          points: o.kind === 'redeem' ? o.points : (o.responsePoints ?? o.points),
          label: o.label,
          at: o.createdAt,
        }));
    },

    async settleOrder(tenant, s): Promise<SettleResult> {
      const link = await linkFor(tenant.id, s.memberId);
      if (!link) return { ok: false, error: 'unknown_member' };
      // Gain d'abord, puis cadeau : YouFID ignorait un crédit envoyé juste après un échange
      // (constaté en recette le 26/11). Points de la commande : calculés par notre règle (points par euro de l'enseigne) et
      // envoyés en crédit forcé, prioritaire chez YouFID : le gain annoncé est le gain crédité.
      let earnError: Exclude<OperationOutcome, { ok: true }>['error'] | null = null;
      if (s.earnPoints > 0) {
        const r = await runOperation(
          tenant,
          {
            key: `order:${s.orderId}:earn`,
            kind: 'earn',
            memberId: link.usrId,
            orderId: s.orderId,
            points: s.earnPoints,
            label: `Commande n° ${s.orderNumber}`,
          },
          async (send) => {
            // `forced_amount` fait foi pour les points ; `amount` (euros exacts) alimente les
            // statistiques du marchand (Splash360, 26/11).
            const res = await send(() =>
              client.scan({
                qrCode: link.qrCode,
                usrId: link.usrId,
                forcedPoints: s.earnPoints,
                amountCents: s.amountCents,
              }),
            );
            return checkScan(res, s.earnPoints);
          },
        );
        if (!r.ok) earnError = r.error;
      }
      // Le cadeau est déduit même si le gain a échoué : le client l'a reçu dans sa commande.
      const reward = s.reward;
      if (reward) {
        const r = await runOperation(
          tenant,
          {
            key: `order:${s.orderId}:redeem`,
            kind: 'redeem',
            memberId: link.usrId,
            orderId: s.orderId,
            points: -reward.costPoints,
            label: `Récompense : ${reward.name}`,
          },
          async (send) => {
            const c = await client.findCustomer({ qrCode: link.qrCode });
            if (!c) throw new Refused('unknown_member');
            if (c.totalPoints < reward.costPoints) throw new Refused('insufficient_points');
            await send(() =>
              client.transformToPresent(link.usrId, [
                { id: reward.id, cost: reward.costPoints, name: reward.name },
              ]),
            ).catch((error: unknown) => {
              // Refus explicite (« Problem during withdrawPoints on LOYALTY ») : rien n'est déduit.
              if (error instanceof YoufidError && error.kind === 'api') {
                throw new Refused('redeem_failed');
              }
              throw error;
            });
            return -reward.costPoints;
          },
        );
        if (!r.ok) return { ok: false, error: r.error };
      }
      if (earnError) return { ok: false, error: earnError };
      return { ok: true };
    },

    async listMembers(tenant, search, limit): Promise<LoyaltyMemberSummary[]> {
      const max = Math.min(limit, ADMIN_LOOKUPS);
      const q = search?.trim() || null;
      const phone = q ? normalizeFrenchPhone(q) : null;
      let links: YoufidMemberLink[];
      if (!q) {
        links = await store.listLinks(tenant.id, max);
      } else if (phone) {
        // La route 7 ne cherche pas par téléphone : seuls les membres liés à l'application.
        const l = await store.findLinkByPhone(tenant.id, phone);
        links = l ? [l] : [];
      } else {
        const users = (await client.listUsers(q)).slice(0, max);
        links = [];
        for (const u of users) {
          links.push(
            (await store.getLink(tenant.id, u.usrId)) ??
              (await store.saveLink(tenant.id, { usrId: u.usrId, qrCode: u.qrCode, phone: null })),
          );
        }
      }
      const out: LoyaltyMemberSummary[] = [];
      for (const link of links) {
        const m = await memberOf(link);
        if (m) out.push({ ...m, createdAt: link.createdAt });
      }
      return out;
    },

    async adjustPoints(tenant, memberId, delta, label, opts): Promise<AdjustResult> {
      if (!Number.isInteger(delta) || delta === 0) throw new Error('Ajustement invalide');
      if (delta < 0) return { ok: false, error: 'unsupported' };
      const link = await linkFor(tenant.id, memberId);
      if (!link) return { ok: false, error: 'unknown_member' };
      const r = await credit(tenant, link, {
        key: opts?.operationKey ?? `adjust:${options.random()}`,
        kind: opts?.kind ?? 'adjust',
        points: delta,
        label: label.trim(),
      });
      if (!r.ok) {
        return {
          ok: false,
          error:
            r.error === 'unknown_member' || r.error === 'daily_limit' || r.error === 'balance_cap'
              ? r.error
              : r.error === 'in_progress'
                ? 'already_processed'
                : 'provider_error',
        };
      }
      const member = await memberOf(link);
      return member ? { ok: true, member } : { ok: false, error: 'unknown_member' };
    },

    deleteMember: (tenant, memberId) =>
      USR_ID.test(memberId) ? store.deleteLink(tenant.id, memberId) : Promise.resolve(false),
  };
  return provider;
}

/** Code court pour le journal et le registre : jamais de corps ni de donnée client. */
function errorCode(error: unknown): string {
  if (error instanceof YoufidError) return `${error.kind}${error.code ? `:${error.code}` : ''}`;
  if (error instanceof RangeError) return 'invalid_input';
  return 'unexpected';
}
