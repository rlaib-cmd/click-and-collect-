import { addCents, cents, type Cents } from './money';

export type OrderMode = 'pickup' | 'delivery';

/** Réglages financiers d'un restaurant (section 6, « Réglages de commande »). */
export interface FeeSettings {
  /** Minimum de commande en livraison (sous-total). */
  readonly deliveryMinimumCents: Cents;
  /** Livraison offerte à partir de ce sous-total ; null = jamais offerte. */
  readonly freeDeliveryThresholdCents: Cents | null;
  /** Frais de service fixes par commande, dans les deux modes (0 = aucun). */
  readonly serviceFeeCents: Cents;
}

export interface Totals {
  readonly subtotalCents: Cents;
  readonly deliveryFeeCents: Cents;
  readonly serviceFeeCents: Cents;
  /** Récompense fidélité déduite (0 sans récompense). */
  readonly discountCents: Cents;
  /** Remise du code promo (0 sans code), appliquée après la récompense (lot 11). */
  readonly promoDiscountCents: Cents;
  /**
   * Promotions de catalogue de la caisse (`reglescatalogue`, lot 24) : remises articles et remise
   * sur la commande (0 sans promotion).
   */
  readonly catalogDiscountCents: Cents;
  /** Frais ajoutés par une règle de catalogue sans produits (`operation` +1). */
  readonly catalogFeeCents: Cents;
  readonly totalCents: Cents;
}

export type TotalsResult =
  | { readonly ok: true; readonly totals: Totals }
  | { readonly ok: false; readonly error: 'below_delivery_minimum'; readonly missingCents: Cents };

/**
 * Totaux de la commande. Frais de livraison : montant de la zone, ramené à 0
 * au-dessus du seuil de livraison offerte. Le minimum ne s'applique qu'à la livraison.
 */
export function computeTotals(input: {
  readonly mode: OrderMode;
  readonly subtotalCents: Cents;
  readonly settings: FeeSettings;
  /** Frais de la zone de livraison (obligatoire en livraison). */
  readonly zoneFeeCents?: Cents | undefined;
}): TotalsResult {
  const { mode, subtotalCents, settings } = input;
  let deliveryFeeCents = cents(0);

  if (mode === 'delivery') {
    if (subtotalCents < settings.deliveryMinimumCents) {
      return {
        ok: false,
        error: 'below_delivery_minimum',
        missingCents: cents(settings.deliveryMinimumCents - subtotalCents),
      };
    }
    if (input.zoneFeeCents === undefined) {
      throw new Error('Frais de zone requis pour une livraison');
    }
    const free =
      settings.freeDeliveryThresholdCents !== null &&
      subtotalCents >= settings.freeDeliveryThresholdCents;
    deliveryFeeCents = free ? cents(0) : input.zoneFeeCents;
  }

  const serviceFeeCents = settings.serviceFeeCents;
  return {
    ok: true,
    totals: {
      subtotalCents,
      deliveryFeeCents,
      serviceFeeCents,
      discountCents: cents(0),
      promoDiscountCents: cents(0),
      catalogDiscountCents: cents(0),
      catalogFeeCents: cents(0),
      totalCents: addCents(subtotalCents, deliveryFeeCents, serviceFeeCents),
    },
  };
}

/** Commission Splash360 : pourcentage (points de base) et/ou montant fixe, plafonnée au total. */
export interface ApplicationFeeSettings {
  /** 100 = 1 %. */
  readonly bps: number;
  readonly fixedCents: Cents;
}

export function computeApplicationFee(totalCents: Cents, settings: ApplicationFeeSettings): Cents {
  if (!Number.isSafeInteger(settings.bps) || settings.bps < 0) {
    throw new RangeError(`Commission invalide : ${settings.bps} points de base`);
  }
  // Arrondi au centime le plus proche, jamais au-delà du montant payé.
  const fee = Math.round((totalCents * settings.bps) / 10_000) + settings.fixedCents;
  return cents(Math.min(fee, totalCents));
}
