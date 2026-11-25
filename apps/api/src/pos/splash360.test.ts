import type { Splash360Client, Splash360Commande, Splash360Reglement } from '@splash360/api-menu';
import { Splash360Error } from '@splash360/api-menu';
import { cents } from '@splash360/core';
import type { OrderDetail, Restaurant } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { PosRejectedError } from './gateway';
import {
  createSplash360PosGateway,
  euros,
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

  it('transmet remises et frais en modificateurs, frais avec leur taux de TVA', () => {
    expect(commande.modificateurs).toEqual([
      { type: 'discount', valeur: '3.50€', nom: 'Cadeau fidélité' },
      { type: 'discount', valeur: '1.00€', nom: 'Code promo' },
      { type: 'frais', valeur: '0.50€', taux: 0.2, nom: 'Frais de service' },
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
