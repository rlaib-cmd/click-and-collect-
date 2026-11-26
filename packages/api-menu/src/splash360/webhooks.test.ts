import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  parseWebhookPayload,
  parseWebhookSecrets,
  signWebhook,
  verifyWebhookSignature,
  webhookChallenge,
} from './webhooks';

/** Vecteur de test du guide Splash360 (§3). */
const VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};
const AT = new Date(1614265330 * 1000);
const bytes = (s: string) => new TextEncoder().encode(s);
const keys = parseWebhookSecrets(VECTOR.secret);

const verify = (over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({
    keys,
    id: VECTOR.id,
    timestamp: VECTOR.timestamp,
    signature: VECTOR.signature,
    body: bytes(VECTOR.body),
    now: AT,
    ...over,
  });

describe('signature Splash360 (Standard Webhooks)', () => {
  it('retrouve exactement la signature du vecteur de test', () => {
    const [key] = keys;
    if (!key) throw new Error('clé absente');
    expect(signWebhook(key, VECTOR.id, Number(VECTOR.timestamp), VECTOR.body)).toBe(
      VECTOR.signature,
    );
    expect(verify()).toBe(true);
  });

  it('vérifie les octets reçus tels quels : un JSON re-sérialisé ne passe plus', () => {
    expect(verify({ body: bytes(JSON.stringify(JSON.parse(VECTOR.body))) })).toBe(false);
  });

  it('accepte une signature parmi plusieurs (changement de secret)', () => {
    expect(
      verify({ signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${VECTOR.signature}` }),
    ).toBe(true);
  });

  it('accepte l’un ou l’autre secret pendant la bascule', () => {
    const both = parseWebhookSecrets(
      `whsec_${Buffer.alloc(32, 7).toString('base64')}, ${VECTOR.secret}`,
    );
    expect(both).toHaveLength(2);
    expect(verify({ keys: both })).toBe(true);
  });

  it('refuse une signature fausse, absente, ou d’une autre version', () => {
    expect(verify({ signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OF=' })).toBe(false);
    expect(verify({ signature: undefined })).toBe(false);
    expect(verify({ signature: VECTOR.signature.replace('v1,', 'v2,') })).toBe(false);
    expect(verify({ id: 'msg_autre' })).toBe(false);
    expect(verify({ keys: [] })).toBe(false);
  });

  it('refuse un horodatage à plus de 5 minutes, dans les deux sens', () => {
    expect(verify({ now: new Date(AT.getTime() + 300_000) })).toBe(true);
    expect(verify({ now: new Date(AT.getTime() + 301_000) })).toBe(false);
    expect(verify({ now: new Date(AT.getTime() - 301_000) })).toBe(false);
    expect(verify({ timestamp: '1614265330.5' })).toBe(false);
  });

  it('refuse un secret illisible sans en citer la valeur', () => {
    expect(() => parseWebhookSecrets('whsec_!!!')).toThrow(/secret n° 1/);
    expect(() => parseWebhookSecrets('pas-un-secret-du-tout')).not.toThrow(/pas-un-secret/);
    expect(() => parseWebhookSecrets('pas-un-secret-du-tout')).toThrow();
    expect(parseWebhookSecrets(undefined)).toEqual([]);
    expect(parseWebhookSecrets(' ')).toEqual([]);
  });
});

describe('corps des webhooks Splash360', () => {
  it('reconnaît le challenge, même dans un objet avec d’autres clés', () => {
    expect(webhookChallenge({ challenge: 'abc' })).toEqual({ challenge: 'abc' });
    expect(webhookChallenge([{ challenge: 'abc' }])).toBeNull();
    expect(webhookChallenge({ order_id: 'x' })).toBeNull();
    expect(webhookChallenge(null)).toBeNull();
  });

  it('disponibilité : états par identifiant, champs inconnus ignorés, élément illisible écarté', () => {
    expect(
      parseWebhookPayload('stock', [
        { item_id: 'prd22947', status: 'unavailable', nouveau: 1 },
        { item_id: 'ing22947-typ5626', status: 'available' },
        { item_id: 'pas valide !', status: 'available' },
        { item_id: 'prd1', status: 'bientôt' },
      ]),
    ).toEqual({
      event: 'stock',
      items: [
        { itemId: 'prd22947', available: false },
        { itemId: 'ing22947-typ5626', available: true },
      ],
      skipped: 2,
    });
    expect(parseWebhookPayload('stock', [])).toEqual({ event: 'stock', items: [], skipped: 0 });
    expect(parseWebhookPayload('stock', { item_id: 'prd1' })).toBeNull();
  });

  it('prix de livraison : euros TTC → centimes', () => {
    expect(parseWebhookPayload('prices', [{ item_id: 'ing22947-typ5626', price: 1.5 }])).toEqual({
      event: 'prices',
      items: [{ itemId: 'ing22947-typ5626', priceCents: 150 }],
      skipped: 0,
    });
    expect(parseWebhookPayload('prices', [{ item_id: 'prd1', price: 0.1 + 0.2 }])).toMatchObject({
      items: [{ priceCents: 30 }],
    });
    expect(parseWebhookPayload('prices', [{ item_id: 'prd1', price: -1 }])).toMatchObject({
      items: [],
      skipped: 1,
    });
  });

  it('mise à jour du catalogue, et appel de test (catalog_id 0)', () => {
    expect(
      parseWebhookPayload('catalog', {
        catalog_id: 12,
        revision: 34,
        installed_at: '2026-10-15T12:00:03.512+02:00',
      }),
    ).toEqual({
      event: 'catalog',
      catalogId: '12',
      revision: '34',
      installedAt: new Date('2026-10-15T10:00:03.512Z'),
      test: false,
    });
    expect(
      parseWebhookPayload('catalog', { catalog_id: 0, revision: 0, installed_at: '…' }),
    ).toMatchObject({ test: true, installedAt: null });
    expect(parseWebhookPayload('catalog', [])).toBeNull();
  });

  it('encaissement / annulation, et appel de test (TEST-)', () => {
    expect(
      parseWebhookPayload('orders', {
        order_id: '6a1f0c2e-8b3d-4f5a-9c7e-1d2b3a4c5d6e',
        status: 'cancelled',
        amount: 23.4,
        occurred_at: '2026-10-15T14:43:58.658843+02:00',
        reason: ' Client parti ',
      }),
    ).toEqual({
      event: 'orders',
      ticketId: '6a1f0c2e-8b3d-4f5a-9c7e-1d2b3a4c5d6e',
      status: 'cancelled',
      amountCents: 2340,
      occurredAt: new Date('2026-10-15T12:43:58.658Z'),
      reason: 'Client parti',
      test: false,
    });
    expect(
      parseWebhookPayload('orders', {
        order_id: 'TEST-6a1f0c2e',
        status: 'paid',
        amount: 0,
        occurred_at: '…',
        reason: 'Test call from the Splash360 back office',
      }),
    ).toMatchObject({ test: true, amountCents: 0, occurredAt: null });
    expect(parseWebhookPayload('orders', { order_id: 'x', status: 'refunded' })).toBeNull();
  });
});
