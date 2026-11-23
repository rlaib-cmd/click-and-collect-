import {
  readCommandeStatus,
  Splash360Error,
  toMenu,
  type Splash360Client,
  type Splash360Commande,
} from '@splash360/api-menu';
import type { OrderDetail, Restaurant } from '@splash360/db';
import type { Splash360Probe } from '../routes/admin';
import { PosRejectedError, type PosGateway } from './gateway';

export interface Splash360PosOptions {
  /**
   * Taux de TVA des frais (livraison, service), exigé par Splash360 pour les modificateurs « frais ».
   * Défaut 0,2 comme l'exemple de la documentation ; à confirmer avec Splash360 (questions-en-attente).
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
  const items = order.lines.map((line, index) => {
    const optionsCents = line.options.reduce((sum, o) => sum + o.priceCents, 0);
    return {
      itemid: index + 1,
      produitid: line.productId,
      quantite: line.quantity,
      price: euros(line.unitPriceCents - optionsCents),
      ingredients: line.options.map((o) => ({
        ingredient: o.optionId,
        qte: 1,
        price: euros(o.priceCents),
      })),
    };
  });

  // Pas de champ pour l'heure de retrait dans l'API : elle part en commentaire (question n° 16).
  const when = order.requestedSlot
    ? `${order.mode === 'delivery' ? 'Livraison' : 'Retrait'} prévu à ${hour(order.requestedSlot, timeZone)}`
    : `Dès que possible (estimé ${hour(order.estimatedAt, timeZone)})`;
  const comments = [
    { id: 1, text: `Commande en ligne n° ${order.number} · ${when}` },
    ...order.lines.flatMap((line, index) =>
      line.note ? [{ id: index + 2, itemid: index + 1, text: line.note }] : [],
    ),
  ];

  const t = order.totals;
  const modificateurs: Splash360Commande['modificateurs'] = [
    ...(t.discountCents > 0
      ? [{ type: 'discount' as const, valeur: eurosLabel(t.discountCents), nom: 'Cadeau fidélité' }]
      : []),
    ...(t.promoDiscountCents > 0
      ? [{ type: 'discount' as const, valeur: eurosLabel(t.promoDiscountCents), nom: 'Code promo' }]
      : []),
    ...(t.deliveryFeeCents > 0
      ? [
          {
            type: 'frais' as const,
            valeur: eurosLabel(t.deliveryFeeCents),
            taux: options.feeVatRate,
            nom: 'Frais de livraison',
          },
        ]
      : []),
    ...(t.serviceFeeCents > 0
      ? [
          {
            type: 'frais' as const,
            valeur: eurosLabel(t.serviceFeeCents),
            taux: options.feeVatRate,
            nom: 'Frais de service',
          },
        ]
      : []),
  ];

  const address = order.deliveryAddress;
  return {
    provider: options.provider ?? 'Splash360 Commande',
    mode,
    status: 'standby',
    total: euros(t.totalCents),
    orderNumber: String(order.number),
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
      return readCommandeStatus(body);
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
  };
}
