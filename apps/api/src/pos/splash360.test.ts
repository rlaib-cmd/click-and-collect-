import type { Splash360Client, Splash360Commande, Splash360Reglement } from '@splash360/api-menu';
import { Splash360Error } from '@splash360/api-menu';
import { cents } from '@splash360/core';
import type { OrderDetail, Restaurant } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { PosRejectedError } from './gateway';
import {
  createSplash360PosGateway,
  euros,
  isoWithOffset,
  splash360SalesSource,
  splitName,
  toSplash360Commande,
} from './splash360';

const restaurant = { id: 'r1', splash360Live: true } as Restaurant;

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    tenantId: 't1',
    restaurantId: 'r1',
    number: 1042,
    status: 'pending_payment',
    mode: 'pickup',
    requestedSlot: '2026-11-24T11:30:00.000Z',
    estimatedAt: '2026-11-24T11:30:00.000Z',
    createdAt: '2026-11-24T10:00:00.000Z',
    totals: {
      subtotalCents: cents(1890),
      deliveryFeeCents: cents(0),
      serviceFeeCents: cents(50),
      discountCents: cents(350),
      promoDiscountCents: cents(100),
      totalCents: cents(1490),
    },
    refundedCents: 0,
    customer: { name: 'Camille Martin', email: 'camille@example.test', phone: '+33600000000' },
    deliveryAddress: null,
    lines: [
      {
        productId: 'prd87',
        name: 'Bills Smoke',
        quantity: 1,
        unitPriceCents: 1290,
        totalCents: 1290,
        note: 'Sans oignon',
        options: [{ groupId: 'g1', optionId: 'ing118', name: 'Cheddar', priceCents: 100 }],
      },
      {
        productId: 'prd1826',
        name: 'Frites',
        quantity: 2,
        unitPriceCents: 300,
        totalCents: 600,
        note: null,
        options: [],
      },
    ],
    events: [],
    accessTokenHash: null,
    paymentMethod: 'online',
    loyalty: null,
    ...overrides,
  };
}

describe('toSplash360Commande', () => {
  const commande = toSplash360Commande(order(), { feeVatRate: 0.2 });

  it('dépose la commande en attente, avec le total calculé par le serveur', () => {
    expect(commande).toMatchObject({
      status: 'standby',
      mode: 'emporter',
      total: 14.9,
      orderNumber: '1042',
    });
  });

  it('traduit les lignes : produit Splash360, prix hors options, options en ingrédients', () => {
    expect(commande.items).toEqual([
      {
        itemid: 1,
        produitid: 'prd87',
        quantite: 1,
        price: 11.9,
        ingredients: [{ ingredient: 'ing118', qte: 1, price: 1 }],
      },
      { itemid: 2, produitid: 'prd1826', quantite: 2, price: 3, ingredients: [] },
    ]);
  });

  it('met l’heure de retrait et les notes de ligne en commentaires', () => {
    expect(commande.comments).toEqual([
      [
        { id: 1, text: 'Commande en ligne n° 1042 · Retrait prévu à 12h30' },
        { id: 2, itemid: 1, text: 'Sans oignon' },
      ],
    ]);
  });

  it('transmet remises et frais en modificateurs, frais au format exact de Splash360', () => {
    expect(commande.modificateurs).toEqual([
      { type: 'discount', valeur: '3.50€', nom: 'Cadeau fidélité' },
      { type: 'discount', valeur: '1.00€', nom: 'Code promo' },
      {
        modificateur_id: 'frais_service',
        type: 'frais',
        valeur: '0.50€',
        taux: 0.2,
        item: null,
        ingredient: null,
        nom: 'Frais',
        operation: 1,
      },
    ]);
    const delivery = toSplash360Commande(
      order({
        totals: { ...order().totals, deliveryFeeCents: cents(100), serviceFeeCents: cents(0) },
      }),
      { feeVatRate: 0.2 },
    );
    expect(delivery.modificateurs.at(-1)).toEqual({
      modificateur_id: 'frais_livraison',
      type: 'frais',
      valeur: '1.00€',
      taux: 0.2,
      item: null,
      ingredient: null,
      nom: 'Frais',
      operation: 1,
    });
  });

  it('heure choisie dans `scheduledAt` (heure de Paris, décalage compris) ; rien pour « dès que possible »', () => {
    expect(commande.scheduledAt).toBe('2026-11-24T12:30:00.000+01:00');
    const summer = toSplash360Commande(order({ requestedSlot: '2026-07-01T10:15:30.177Z' }), {
      feeVatRate: 0.2,
    });
    expect(summer.scheduledAt).toBe('2026-07-01T12:15:30.177+02:00');
    const asap = toSplash360Commande(order({ requestedSlot: null }), { feeVatRate: 0.2 });
    expect(asap).not.toHaveProperty('scheduledAt');
    expect(isoWithOffset('2026-11-26T13:22:22.177Z', 'Europe/Paris')).toBe(
      '2026-11-26T14:22:22.177+01:00',
    );
    expect(isoWithOffset('2026-11-26T13:22:22.177Z', 'UTC')).toBe('2026-11-26T13:22:22.177+00:00');
  });

  it('ingrédients : identifiant complet, même option deux fois en `qte: 2`, étape imbriquée à plat', () => {
    const formule = toSplash360Commande(
      order({
        lines: [
          {
            productId: 'prd15156',
            name: 'Menu',
            quantity: 1,
            unitPriceCents: 600 + 50 + 50 + 150,
            totalCents: 850,
            note: null,
            options: [
              {
                groupId: 'typ2076',
                optionId: 'ing15412-typ2076',
                name: 'Algérienne',
                priceCents: 50,
              },
              {
                groupId: 'typ2076',
                optionId: 'ing15412-typ2076',
                name: 'Algérienne',
                priceCents: 50,
              },
              { groupId: 'typ2079', optionId: 'ing15278-typ2079', name: 'Frites', priceCents: 150 },
              {
                groupId: 'ing15278-typ2079>typ2081',
                optionId: 'ing15278-typ2079>ing15300-typ2081',
                name: 'Salées',
                priceCents: 0,
              },
            ],
          },
        ],
      }),
      { feeVatRate: 0.2 },
    );
    expect(formule.items).toEqual([
      {
        itemid: 1,
        produitid: 'prd15156',
        quantite: 1,
        price: 6,
        ingredients: [
          { ingredient: 'ing15412-typ2076', qte: 2, price: 0.5 },
          { ingredient: 'ing15278-typ2079', qte: 1, price: 1.5 },
          {
            ingredient: 'ing15300-typ2081',
            qte: 1,
            price: 0,
            ingid: 'ing15300-typ2081',
            parentid: 'ing15278-typ2079',
          },
        ],
      },
    ]);
  });

  it('renseigne le client et, en livraison, son adresse', () => {
    expect(commande.client).toEqual({
      prenom: 'Camille',
      nom: 'Martin',
      telephone: '+33600000000',
      email: 'camille@example.test',
      mode: 'emporter',
    });
    const delivery = toSplash360Commande(
      order({
        mode: 'delivery',
        requestedSlot: null,
        deliveryAddress: {
          label: '1 rue Exemple',
          postalCode: '75001',
          city: 'Paris',
          latitude: null,
          longitude: null,
          instructions: 'Code 1234',
        },
      }),
      { feeVatRate: 0.1 },
    );
    expect(delivery.mode).toBe('livraison');
    expect(delivery.client).toMatchObject({
      adresse: '1 rue Exemple',
      codepostal: '75001',
      ville: 'Paris',
      commentaire: 'Code 1234',
      mode: 'livraison',
    });
    expect(delivery.comments[0]?.[0]?.text).toBe(
      'Commande en ligne n° 1042 · Dès que possible (estimé 12h30)',
    );
  });
});

describe('montants et noms', () => {
  it('convertit les centimes en euros sans erreur d’arrondi', () => {
    expect(euros(1490)).toBe(14.9);
    expect(euros(10)).toBe(0.1);
    expect(euros(0)).toBe(0);
    expect(euros(123456)).toBe(1234.56);
  });

  it('sépare prénom et nom', () => {
    expect(splitName('Camille Martin')).toEqual({ prenom: 'Camille', nom: 'Martin' });
    expect(splitName('Jean Pierre  Dupont')).toEqual({ prenom: 'Jean Pierre', nom: 'Dupont' });
    expect(splitName('Prince')).toEqual({ prenom: 'Prince', nom: 'Prince' });
  });
});

describe('caisse Splash360', () => {
  function fakeClient(status: unknown = { status: 'ready' }) {
    const sent: { commandes: Splash360Commande[]; reglements: Splash360Reglement[][] } = {
      commandes: [],
      reglements: [],
    };
    const client: Splash360Client = {
      getMenus: () => Promise.resolve({}),
      getMenusAt: () => Promise.resolve({}),
      listSales: () => Promise.resolve({}),
      submitCommande(c) {
        sent.commandes.push(c);
        return Promise.resolve({ ticketId: 'ticket-1' });
      },
      getCommandeStatus: () => Promise.resolve(status),
      submitPaiement(_t, r) {
        sent.reglements.push([...r]);
        return Promise.resolve();
      },
    };
    return { client, sent };
  }

  it('dépose, lit le statut et notifie un paiement par carte ou sur place', async () => {
    const { client, sent } = fakeClient();
    const pos = createSplash360PosGateway(client, { feeVatRate: 0.2 });
    expect(await pos.openTicket(order(), restaurant)).toEqual({ ticketId: 'ticket-1' });
    expect(
      await pos.ticketStatus({
        ticketId: 'ticket-1',
        restaurant,
        openedAt: new Date(),
        paymentSentAt: null,
      }),
    ).toEqual({ state: 'ready', raw: 'ready' });
    await pos.submitPayment(
      { ticketId: 'ticket-1', restaurant },
      { method: 'card', amountCents: 1490, reference: 'pi_123' },
    );
    await pos.submitPayment({ ticketId: 'ticket-1', restaurant }, { method: 'on_site' });
    expect(sent.reglements).toEqual([[{ type: 'carte', valeur: 14.9, detail: 'pi_123' }], []]);
  });

  it('transforme les erreurs Splash360 en refus de caisse, réessayables ou non', async () => {
    const client: Splash360Client = {
      ...fakeClient().client,
      submitCommande: () => Promise.reject(new Splash360Error('HTTP 503', 503, true)),
      submitPaiement: () => Promise.reject(new Splash360Error('Ticket inconnu', 200, false)),
    };
    const pos = createSplash360PosGateway(client, { feeVatRate: 0.2 });
    await expect(pos.openTicket(order(), restaurant)).rejects.toMatchObject({
      name: 'PosRejectedError',
      retryable: true,
    });
    const error = await pos
      .submitPayment({ ticketId: 't', restaurant }, { method: 'on_site' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PosRejectedError);
    expect(error).toMatchObject({ retryable: false });
  });
});

describe('export des ventes pour l’achat vérifié (lot 20)', () => {
  const base: Splash360Client = {
    getMenus: () => Promise.resolve({}),
    getMenusAt: () => Promise.resolve({}),
    listSales: () => Promise.resolve({}),
    submitCommande: () => Promise.resolve({ ticketId: 't' }),
    getCommandeStatus: () => Promise.resolve({}),
    submitPaiement: () => Promise.resolve(),
  };

  it('demande une journée entière, ventes encaissées et annulées, 100 par page', async () => {
    const queries: unknown[] = [];
    const source = splash360SalesSource({
      ...base,
      listSales(q) {
        queries.push(q);
        return Promise.resolve({ data: [], pagination: { hasNextPage: false } });
      },
    });
    expect(await source.fetchPage('2026-11-24', 2)).toEqual({
      ok: true,
      page: { sales: [], hasNextPage: false, skipped: 0 },
    });
    expect(queries).toEqual([
      {
        fromDate: '2026-11-24',
        toDate: '2026-11-24',
        status: 'confirmed,deleted',
        page: 2,
        pageSize: 100,
      },
    ]);
  });

  it('pause d’une minute (429) distinguée d’une panne ou d’un format inconnu', async () => {
    const failing = (error: Error) =>
      splash360SalesSource({ ...base, listSales: () => Promise.reject(error) });
    const wait = new Splash360Error('un export par minute', 429, true, 30_000);
    expect(await failing(wait).fetchPage('2026-11-24', 0)).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
    const down = new Splash360Error('HTTP 500', 500, true);
    expect(await failing(down).fetchPage('2026-11-24', 0)).toMatchObject({
      ok: false,
      reason: 'error',
    });
    const odd = splash360SalesSource({ ...base, listSales: () => Promise.resolve({ x: 1 }) });
    expect(await odd.fetchPage('2026-11-24', 0)).toMatchObject({ ok: false, reason: 'error' });
  });
});
