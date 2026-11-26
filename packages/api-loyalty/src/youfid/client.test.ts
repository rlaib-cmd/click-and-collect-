import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { centsToEuros, createYoufidClient, scanRefusal, YoufidError, youfidPhone } from './client';
import { createFakeYoufid, FAKE_MERCHANT_ID, FAKE_PIN } from './fake-youfid';
import { decodeSessionKey, signYoufidRequest, youfidAuthorization } from './signature';

const NOW = Date.parse('2026-11-25T12:00:00Z');

function setup(overrides: { nonce?: () => string; password?: string } = {}) {
  let t = NOW;
  const fake = createFakeYoufid({ now: () => t });
  let n = 0;
  const client = createYoufidClient({
    login: 'marchand',
    password: overrides.password ?? 'secret-de-test',
    deviceId: 'splash360-commande-test',
    fetch: fake.fetch,
    now: () => t,
    nonce: overrides.nonce ?? (() => `nonce-${String(++n)}`),
  });
  return {
    fake,
    client,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('signature YouFID', () => {
  // Clé de 128 caractères hexadécimaux → 64 caractères une fois décodée (documentation, § Calcul).
  const keyHex = Buffer.from('0123456789abcdef'.repeat(4)).toString('hex');

  it('décode la clé de session hexadécimale en 64 caractères', () => {
    expect(keyHex).toHaveLength(128);
    const key = decodeSessionKey(keyHex);
    expect(key.toString('utf8')).toBe('0123456789abcdef'.repeat(4));
    expect(() => decodeSessionKey('xyz')).toThrow('mal formée');
    expect(() => decodeSessionKey('abc')).toThrow('mal formée');
  });

  it('signe corps + fid_client_id + nonce + timestamp (vecteur connu)', () => {
    const input = {
      body: '{"merchant_id":123456}',
      clientId: '123456',
      nonce: '2322344',
      timestamp: 1549973079,
      key: decodeSessionKey(keyHex),
    };
    // Vecteur calculé hors du code (Python hmac/hashlib) d'après la documentation.
    expect(signYoufidRequest(input)).toBe(
      'a91f22a7a525fca7cd59e7154aec92c2b8b510c522167b802c84f78c22e47ba0',
    );
    // Et recalculé ici sans passer par le module.
    const independent = createHmac('sha256', Buffer.from('0123456789abcdef'.repeat(4)))
      .update('{"merchant_id":123456}1234562322344' + '1549973079')
      .digest('hex');
    expect(signYoufidRequest(input)).toBe(independent);
    expect(youfidAuthorization(input)).toBe(
      'fid_client_id=123456,nonce=2322344,timestamp=1549973079,sign_algo=HMAC_SHA256,' +
        'sign=a91f22a7a525fca7cd59e7154aec92c2b8b510c522167b802c84f78c22e47ba0',
    );
  });
});

describe('client YouFID', () => {
  it('se connecte une fois, signe chaque requête du corps exact envoyé, nonces uniques', async () => {
    const { fake, client } = setup({ nonce: () => Math.random().toString(36).slice(2) });
    await client.merchantDetails();
    await client.findCustomer({ qrCode: 'absent' });
    expect(fake.inits).toBe(1);
    const init = fake.calls[0];
    expect(init?.route).toBe('marchandInitMarchand');
    expect(init?.authorization).toBeNull();
    expect(init?.body).toEqual({
      login: 'marchand',
      password: 'secret-de-test',
      device_id: 'splash360-commande-test',
    });
    const signed = fake.calls.slice(1);
    expect(signed).toHaveLength(2);
    for (const c of signed) {
      expect(c.authorization).toMatch(
        new RegExp(
          `^fid_client_id=${String(FAKE_MERCHANT_ID)},nonce=[a-z0-9]+,timestamp=${String(
            Math.floor(NOW / 1000),
          )},sign_algo=HMAC_SHA256,sign=[0-9a-f]{64}$`,
        ),
      );
      expect(c.body.merchant_id).toBe(FAKE_MERCHANT_ID);
    }
    const nonces = signed.map((c) => /nonce=([^,]+)/.exec(c.authorization ?? '')?.[1]);
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('un nonce rejoué est refusé : ERR0401, réinitialisation unique puis échec', async () => {
    const { fake, client } = setup({ nonce: () => 'toujours-le-meme' });
    await client.merchantDetails();
    await expect(client.merchantDetails()).rejects.toMatchObject({
      kind: 'auth',
      code: 'ERR0401',
    });
    expect(fake.inits).toBe(2);
  });

  it('clé remplacée (ERR0401 en HTTP 200) : se réinitialise une fois et rejoue', async () => {
    const { fake, client } = setup();
    await client.merchantDetails();
    fake.rotateKey();
    const details = await client.merchantDetails();
    expect(details.programName).toBe('Club Test');
    expect(fake.inits).toBe(2);
  });

  it('se réinitialise avant l’expiration de la clé d’appareil', async () => {
    const { fake, client, advance } = setup();
    await client.merchantDetails();
    advance(47 * 3600_000);
    await client.merchantDetails();
    expect(fake.inits).toBe(1);
    advance(55 * 60_000);
    await client.merchantDetails();
    expect(fake.inits).toBe(2);
  });

  it('connexion refusée : erreur « auth » sans identifiant dans le message', async () => {
    const { client } = setup({ password: 'mauvais' });
    const error = await client.merchantDetails().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YoufidError);
    expect((error as YoufidError).kind).toBe('auth');
    expect(String((error as Error).message)).not.toContain('mauvais');
    expect(String((error as Error).message)).not.toContain('secret');
  });

  it('lit le statut du corps, quel que soit le statut HTTP', async () => {
    const { fake, client } = setup();
    fake.once('registerCustomerByPhone', () => ({
      status: 400,
      json: { status: 'error', message: 'phone manquant', code: 'ERR0400' },
    }));
    await expect(client.registerByPhone('+33612345678')).rejects.toMatchObject({
      kind: 'api',
      code: 'ERR0400',
      httpStatus: 400,
    });
    fake.once('marchandGetMerchantDetailsV2', () => ({
      json: { status: 'error', message: 'Marchand inconnu', code: 'ERR0404' },
    }));
    await expect(client.merchantDetails()).rejects.toMatchObject({ kind: 'api', code: 'ERR0404' });
  });

  it('accepte « success » pour la route 12', async () => {
    const { fake, client } = setup();
    const c = fake.addCustomer({ phone: '+33611111111' });
    await client.submitProfileResponse(String(c.usrId), { id: '7', type: 'NAME' }, 'Léa');
    expect(c.prenom).toBe('Léa');
  });

  it('n’expose que les routes utilisées (1, 2, 3, 5, 6, 7, 10, 12)', () => {
    const { client } = setup();
    expect(Object.keys(client).sort()).toEqual([
      'findCustomer',
      'listUsers',
      'merchantDetails',
      'registerByPhone',
      'scan',
      'session',
      'submitProfileResponse',
      'transformToPresent',
    ]);
  });

  it('retire le PIN client des réponses (routes 3 et 5)', async () => {
    const { fake, client } = setup();
    const c = fake.addCustomer({ phone: '+33622222222', points: 40 });
    const found = await client.findCustomer({ qrCode: c.qrCode });
    expect(found).toMatchObject({ usrId: String(c.usrId), totalPoints: 40, qrCode: c.qrCode });
    expect(JSON.stringify(found)).not.toContain(FAKE_PIN);
    const scan = await client.scan({ qrCode: c.qrCode, usrId: String(c.usrId), amountCents: 1250 });
    expect(JSON.stringify(scan)).not.toContain(FAKE_PIN);
    expect(scan).toEqual({
      usrId: String(c.usrId),
      wonPoints: 125,
      totalPoints: 165,
      maximumScansReached: false,
      refusal: null,
      code: '',
    });
    expect(await client.findCustomer({ email: 'personne@example.fr' })).toBeNull();
  });

  it('envoie le montant en euros exacts, un crédit forcé positif, ou les deux', async () => {
    const { fake, client } = setup();
    const c = fake.addCustomer({ phone: '+33633333333' });
    await client.scan({ qrCode: c.qrCode, usrId: String(c.usrId), amountCents: 1005 });
    expect(fake.calls.at(-1)?.raw).toContain('"amount":10.05');
    await client.scan({ qrCode: c.qrCode, usrId: String(c.usrId), forcedPoints: 50 });
    expect(fake.calls.at(-1)?.body).toMatchObject({ forced_amount: 50, usr_id: c.usrId });
    expect(fake.calls.at(-1)?.body).not.toHaveProperty('amount');
    // Commande : forced_amount fait foi, amount (euros exacts) pour les statistiques du marchand.
    const both = await client.scan({
      qrCode: c.qrCode,
      usrId: String(c.usrId),
      forcedPoints: 12,
      amountCents: 1299,
    });
    expect(fake.calls.at(-1)?.raw).toContain('"forced_amount":12,"amount":12.99');
    expect(both.wonPoints).toBe(12);
    // qr_code toujours envoyé en texte, jamais converti en nombre.
    expect(fake.calls.at(-1)?.raw).toContain(`"qr_code":"${c.qrCode}"`);
    await expect(
      client.scan({ qrCode: c.qrCode, usrId: String(c.usrId), forcedPoints: -5 }),
    ).rejects.toThrow(RangeError);
  });

  it('inscrit par téléphone au format E.164 et distingue client existant et nouveau', async () => {
    const { fake, client } = setup();
    const created = await client.registerByPhone('+33644444444');
    expect(created.existing).toBe(false);
    expect(fake.calls.at(-1)?.body.phone).toBe('+33644444444');
    // QR code en texte (8 chiffres commençant par 1 pour un compte créé par téléphone).
    expect(created.qrCode).toMatch(/^1\d{7}$/);
    const again = await client.registerByPhone('+33644444444');
    expect(again).toMatchObject({ existing: true, usrId: created.usrId, qrCode: created.qrCode });
  });

  it('cadeaux (route 2) triés du moins cher, recherche (route 7), question de profil (route 3)', async () => {
    const { fake, client } = setup();
    const details = await client.merchantDetails();
    expect(details.products.map((p) => [p.id, p.cost])).toEqual([
      ['11', 300],
      ['12', 500],
    ]);
    expect(details.pointsOnAmount).toBe(true);
    expect(JSON.stringify(details)).not.toContain('"0000"');
    const c = fake.addCustomer({ phone: '+33655555555', nom: 'Martin', email: 'm@example.fr' });
    const users = await client.listUsers('mart');
    expect(users).toEqual([
      {
        usrId: String(c.usrId),
        firstName: 'Camille',
        lastName: 'Martin',
        email: 'm@example.fr',
        qrCode: c.qrCode,
      },
    ]);
    const found = await client.findCustomer({ qrCode: c.qrCode });
    expect(found?.profileQuestion).toBeNull();
    const fresh = fake.addCustomer({ phone: '+33655555556', email: null });
    const pending = await client.findCustomer({ qrCode: fresh.qrCode });
    expect(pending?.profileQuestion).toEqual({ id: '8', type: 'EMAIL' });
    const t = await client.transformToPresent(String(c.usrId), []);
    expect(t.totalPoints).toBe(0);
  });

  it('route 5 : refus par `code` (status ok, won_pts « 0 ») ; route 10 : « Duplicated user »', async () => {
    const { fake, client } = setup();
    const c = fake.addCustomer({ phone: '+33677777777', points: 500 });
    fake.state.balanceCap = 500;
    const capped = await client.scan({ qrCode: c.qrCode, usrId: String(c.usrId), forcedPoints: 5 });
    expect(capped).toMatchObject({
      wonPoints: 0,
      refusal: 'balance_cap',
      code: 'MAX_POINTS_REACHED',
      maximumScansReached: false,
    });
    fake.state.duplicatedUser = true;
    const e = await client.registerByPhone('+33688888888').catch((x: unknown) => x as YoufidError);
    expect(e).toBeInstanceOf(YoufidError);
    expect(e).toMatchObject({ kind: 'api', duplicatedUser: true });
  });

  it('panne réseau ou réponse illisible : issue inconnue', async () => {
    const { fake, client } = setup();
    await client.merchantDetails();
    fake.once('marchandCheckScanUser', () => 'network');
    const e1 = await client
      .scan({ qrCode: 'x', usrId: '1', amountCents: 100 })
      .catch((e: unknown) => e as YoufidError);
    expect(e1).toMatchObject({ kind: 'network', uncertain: true });
    fake.once('marchandCheckScanUser', () => 'html');
    const e2 = await client
      .scan({ qrCode: 'x', usrId: '1', amountCents: 100 })
      .catch((e: unknown) => e as YoufidError);
    expect(e2).toMatchObject({ kind: 'invalid_response', uncertain: true, httpStatus: 500 });
  });

  it('marchand sans signature (sec_type none) : pas d’en-tête Authorization', async () => {
    const { fake, client } = setup();
    fake.state.secType = 'none';
    await client.merchantDetails();
    expect(fake.calls.at(-1)?.authorization).toBeNull();
  });
});

describe('conversions', () => {
  it('centimes → euros exacts', () => {
    expect(centsToEuros(0)).toBe(0);
    expect(centsToEuros(7)).toBe(0.07);
    expect(centsToEuros(1005)).toBe(10.05);
    expect(JSON.stringify({ a: centsToEuros(123456789) })).toBe('{"a":1234567.89}');
    expect(() => centsToEuros(1.5)).toThrow(RangeError);
    expect(() => centsToEuros(-1)).toThrow(RangeError);
  });

  it('téléphone toujours en E.164 (jamais au format national 06…)', () => {
    expect(youfidPhone('+33612345678')).toBe('+33612345678');
    expect(youfidPhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(youfidPhone('+32470123456')).toBe('+32470123456');
    expect(() => youfidPhone('0612345678')).toThrow(RangeError);
  });

  it('code de la route 5 → refus', () => {
    expect(scanRefusal('MAX_POINTS_REACHED', false)).toBe('balance_cap');
    expect(scanRefusal('MAX_SCAN_REACHED', true)).toBe('daily_limit');
    expect(scanRefusal('AMOUNT_TOO_HIGH', false)).toBe('amount_too_high');
    expect(scanRefusal('', false)).toBeNull();
    expect(scanRefusal(null, true)).toBe('daily_limit');
  });
});
