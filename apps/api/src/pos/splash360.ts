import {
  readCommandeStatus,
  readSalesPage,
  Splash360Error,
  SPLASH360_DEFAULT_MENU_PATH,
  toMenu,
  type Splash360Client,
  type Splash360Commande,
  type Splash360CommandeIngredient,
  type Splash360FeeModificateur,
  type Splash360ItemDiscountModificateur,
} from '@splash360/api-menu';
import { itemPercentLabel, splitOptionId } from '@splash360/core';
import type { OrderDetail, Restaurant } from '@splash360/db';
import type { Splash360Probe } from '../routes/admin';
import type { SalesSource } from '../loyalty/ticket-check';
import { PosRejectedError, type PosGateway } from './gateway';

export interface Splash360PosOptions {
  /**
   * Taux de TVA des frais (livraison, service), exigé par Splash360 pour les modificateurs
   * « frais » : 0,2 (20 %), confirmé par Splash360 le 26/11.
   */
  readonly feeVatRate: number;
  /** Nom de l'application qui dépose la commande (`provider`). */
  readonly provider?: string;
  readonly timeZone?: string;
}

/** Centimes → euros, comme l'API Splash360 (nombre à deux décimales, calculé sur des entiers). */
export function euros(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

function eurosLabel(amountCents: number): string {
  return `${(Math.round(amountCents) / 100).toFixed(2)}€`;
}

/** « Camille Martin » → prénom « Camille », nom « Martin » ; un seul mot sert aux deux. */
export function splitName(full: string): { prenom: string; nom: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { prenom: 'Client', nom: 'Client' };
  if (words.length === 1) return { prenom: words[0] ?? '', nom: words[0] ?? '' };
  return { prenom: words.slice(0, -1).join(' '), nom: words.at(-1) ?? '' };
}

/**
 * Date ISO 8601 à l'heure locale du fuseau, millisecondes et décalage compris :
 * « 2026-11-26T14:22:22.177+01:00 » pour Paris (format donné par Splash360 le 26/11).
 */
export function isoWithOffset(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  // « GMT+01:00 » ; « GMT » seul pour un décalage nul.
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms}${offset}`;
}

/**
 * Options d'une ligne → ingrédients `submitcommande` (réponses du 26/11) : identifiant complet,
 * une option répétée part une fois avec sa quantité (`qte`) et son prix unitaire ; une option
 * d'étape imbriquée (« a>b », jusqu'à « a>b>c>d ») part à plat avec `ingid` et `parentid` (ingrédient
 * parent direct).
 */
export function toIngredients(
  options: readonly { readonly optionId: string; readonly priceCents: number }[],
): Splash360CommandeIngredient[] {
  const out: { id: string; qte: number; priceCents: number }[] = [];
  for (const o of options) {
    const same = out.find((x) => x.id === o.optionId && x.priceCents === o.priceCents);
    if (same) same.qte += 1;
    else out.push({ id: o.optionId, qte: 1, priceCents: o.priceCents });
  }
  return out.map(({ id, qte, priceCents }) => {
    const { parentId, optionId } = splitOptionId(id);
    return {
      ingredient: optionId,
      qte,
      price: euros(priceCents),
      ...(parentId ? { ingid: optionId, parentid: splitOptionId(parentId).optionId } : {}),
    };
  });
}

/** Frais au format exact de Splash360 (26/11) : `valeur` « 1.00€ », TVA dans `taux`. */
function fee(id: string, valeur: string, taux: number, nom = 'Frais'): Splash360FeeModificateur {
  return {
    modificateur_id: id,
    type: 'frais',
    valeur,
    taux,
    item: null,
    ingredient: null,
    nom,
    operation: 1,
  };
}

/** Nom de la remise d'article du cadeau fidélité (un seul article, prix de base offert). */
export const LOYALTY_GIFT_NAME = 'Cadeau fidélité';

/** Remise d'un article, une entrée par article remisé (format de la borne, 26/11). */
function itemDiscount(
  origin: string,
  nom: string,
  valeur: string,
): Splash360ItemDiscountModificateur {
  return { type: 'discount', origin, nom, operation: -1, valeur, itemOnly: true };
}

function hour(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone })
    .format(new Date(iso))
    .replace(':', 'h');
}

/**
 * Commande au format `submitcommande`. Les montants viennent de la commande enregistrée
 * (calcul serveur, `packages/core`), jamais de l'application.
 */
export function toSplash360Commande(
  order: OrderDetail,
  options: Splash360PosOptions,
): Splash360Commande {
  const timeZone = options.timeZone ?? 'Europe/Paris';
  const mode = order.mode === 'delivery' ? 'livraison' : 'emporter';
  const t = order.totals;
  // Cadeau fidélité : remise existante sur un article (le premier du produit offert), envoyée
  // comme remise d'article pour que la caisse ne lui applique pas une promotion de catalogue.
  const rewardProductId = order.loyalty?.rewardProductId ?? null;
  const rewardLine =
    t.discountCents > 0 && rewardProductId
      ? order.lines.findIndex((l) => l.productId === rewardProductId && l.quantity > 0)
      : -1;
  const items = order.lines.map((line, index) => {
    const optionsCents = line.options.reduce((sum, o) => sum + o.priceCents, 0);
    const modificateurs = [
      ...(index === rewardLine
        ? [
            itemDiscount(
              'loyalty',
              LOYALTY_GIFT_NAME,
              itemPercentLabel(t.discountCents, line.unitPriceCents),
            ),
          ]
        : []),
      // Promotions de catalogue : une entrée par article remisé, nom exact de la règle.
      ...(line.discounts ?? []).flatMap((d) =>
        Array.from({ length: d.units }, () => itemDiscount('bogo', d.name, d.percentLabel)),
      ),
    ];
    return {
      itemid: index + 1,
      produitid: line.productId,
      quantite: line.quantity,
      price: euros(line.unitPriceCents - optionsCents),
      ingredients: toIngredients(line.options),
      ...(modificateurs.length > 0 ? { modificateurs } : {}),
    };
  });

  // Heure choisie : `scheduledAt` (réponse du 26/11), répétée en commentaire pour l'équipe.
  // « Dès que possible » : pas de `scheduledAt`, l'heure estimée reste en commentaire seulement.
  const when = order.requestedSlot
    ? `${order.mode === 'delivery' ? 'Livraison' : 'Retrait'} prévu à ${hour(order.requestedSlot, timeZone)}`
    : `Dès que possible (estimé ${hour(order.estimatedAt, timeZone)})`;
  const comments = [
    { id: 1, text: `Commande en ligne n° ${order.number} · ${when}` },
    ...order.lines.flatMap((line, index) =>
      line.note ? [{ id: index + 2, itemid: index + 1, text: line.note }] : [],
    ),
  ];

  const adjustments = order.catalogAdjustments ?? [];
  const modificateurs: Splash360Commande['modificateurs'] = [
    // Ancienne commande sans produit offert connu : remise sur la commande, comme avant.
    ...(t.discountCents > 0 && rewardLine < 0
      ? [{ type: 'discount' as const, valeur: eurosLabel(t.discountCents), nom: LOYALTY_GIFT_NAME }]
      : []),
    // Une seule remise sur la commande : le code promo du client, sinon la règle de catalogue.
    ...(t.promoDiscountCents > 0
      ? [{ type: 'discount' as const, valeur: eurosLabel(t.promoDiscountCents), nom: 'Code promo' }]
      : []),
    ...adjustments
      .filter((a) => a.kind === 'discount')
      .map((a) => ({
        type: 'discount' as const,
        valeur: a.valueLabel,
        nom: a.name,
        operation: -1 as const,
      })),
    ...(t.deliveryFeeCents > 0
      ? [fee('frais_livraison', eurosLabel(t.deliveryFeeCents), options.feeVatRate)]
      : []),
    ...(t.serviceFeeCents > 0
      ? [fee('frais_service', eurosLabel(t.serviceFeeCents), options.feeVatRate)]
      : []),
    // Frais d'une promotion de catalogue : valeur et nom de la règle, sa TVA si reçue.
    ...adjustments
      .filter((a) => a.kind === 'fee')
      .map((a) => fee(a.ruleId, a.valueLabel, a.vatRate ?? options.feeVatRate, a.name)),
  ];

  const address = order.deliveryAddress;
  return {
    provider: options.provider ?? 'Splash360 Commande',
    mode,
    status: 'standby',
    total: euros(t.totalCents),
    orderNumber: String(order.number),
    ...(order.requestedSlot ? { scheduledAt: isoWithOffset(order.requestedSlot, timeZone) } : {}),
    items,
    comments: [comments],
    client: {
      ...splitName(order.customer.name),
      telephone: order.customer.phone,
      ...(order.customer.email ? { email: order.customer.email } : {}),
      ...(address
        ? {
            adresse: address.label,
            codepostal: address.postalCode,
            ville: address.city,
            ...(address.instructions ? { commentaire: address.instructions } : {}),
          }
        : {}),
      mode,
    },
    modificateurs,
  };
}

function translate(error: unknown): never {
  if (error instanceof Splash360Error) throw new PosRejectedError(error.message, error.retryable);
  throw error;
}

/** Caisse réelle : appelle l'API Click & Collect Splash360 via `@splash360/api-menu`. */
export function createSplash360PosGateway(
  client: Splash360Client,
  options: Splash360PosOptions,
): PosGateway {
  return {
    async openTicket(order: OrderDetail, _restaurant: Restaurant) {
      return client.submitCommande(toSplash360Commande(order, options)).catch(translate);
    },
    async ticketStatus({ ticketId }) {
      const body = await client.getCommandeStatus(ticketId).catch(translate);
      const status = readCommandeStatus(body);
      // Format de réponse non documenté : sans statut reconnu, on garde un extrait de la réponse
      // brute (sans données client : cmdstatus ne renvoie que l'état du ticket) pour le diagnostic.
      return status.raw === null && body !== null && body !== undefined
        ? { ...status, raw: JSON.stringify(body).slice(0, 300) }
        : status;
    },
    async submitPayment({ ticketId }, payment) {
      const reglements =
        payment.method === 'card'
          ? [
              {
                type: 'carte' as const,
                valeur: euros(payment.amountCents),
                detail: payment.reference,
              },
            ]
          : [];
      await client.submitPaiement(ticketId, reglements).catch(translate);
    },
  };
}

/** Test de connexion du back-office : jeton OAuth, puis lecture et traduction de la carte. */
export function splash360Probe(client: Splash360Client, baseUrl: string): Splash360Probe {
  return {
    async probe() {
      const menu = toMenu(await client.getMenus(), 'test', baseUrl);
      return { products: menu.products.length, categories: menu.categories.length };
    },
    rawMenu: () => client.getMenusAt(SPLASH360_DEFAULT_MENU_PATH),
    rawSales: (date, pageSize = 5, page = 0) =>
      client.listSales({
        fromDate: date,
        toDate: date,
        status: 'confirmed,deleted',
        pageSize,
        page,
      }),
  };
}

/**
 * Export des ventes pour l'« achat vérifié » (lot 20, ADR 0025) : une page d'une journée,
 * ventes encaissées et annulées. La pause d'une minute (429) n'est pas une panne.
 */
export function splash360SalesSource(client: Splash360Client): SalesSource {
  return {
    async fetchPage(jour, page) {
      try {
        const body = await client.listSales({
          fromDate: jour,
          toDate: jour,
          status: 'confirmed,deleted',
          page,
          pageSize: 100,
        });
        return { ok: true, page: readSalesPage(body) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Splash360Error && error.status === 429)
          return { ok: false, reason: 'rate_limited', message };
        return { ok: false, reason: 'error', message };
      }
    },
  };
}
