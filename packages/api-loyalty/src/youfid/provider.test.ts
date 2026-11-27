import { describe, expect, it } from 'vitest';
import { LoyaltyUnsupportedError, type LoyaltyTenant } from '../provider';
import { createRoutingLoyaltyProvider, createYoufidRegistry, noLoyaltyProvider } from '../routing';
import { createDemoLoyaltyProvider, createMemoryDemoLoyaltyStore } from '../demo';
import { createYoufidClient } from './client';
import { parseYoufidAccounts, youfidDeviceId } from './config';
import { createFakeYoufid, FAKE_PIN } from './fake-youfid';
import {
  createYoufidLoyaltyProvider,
  LoyaltyDuplicateCustomerError,
  rewardLabel,
  STALE_OPERATION_MS,
} from './provider';
import { createMemoryYoufidStore } from './store';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const tenant: LoyaltyTenant = { id: 't-chicken', splash360Id: 'S360-CHICKEN' };

function setup() {
  let t = NOW;
  const clock = () => t;
  const fake = createFakeYoufid({ now: clock });
  const logs: { message: string; data?: Record<string, unknown> }[] = [];
  const store = createMemoryYoufidStore(() => new Date(t));
  let n = 0;
  const client = createYoufidClient({
    login: 'marchand',
    password: 'secret-de-test',
    fetch: fake.fetch,
    now: clock,
  });
  const loyalty = createYoufidLoyaltyProvider({
    client,
    store,
    random: () => `op-${String(++n)}`,
    now: () => new Date(t),
    log: (message, data) => logs.push({ message, ...(data ? { data } : {}) }),
  });
  return {
    fake,
    store,
    loyalty,
    logs,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const order = (memberId: string, orderId: string, extra: Partial<{ reward: boolean }> = {}) => ({
  memberId,
  orderId,
  orderNumber: 1042,
  earnPoints: 125,
  amountCents: 1250,
  reward: extra.reward ? { id: '11', name: 'Frites offertes', costPoints: 300 } : null,
});

describe('fournisseur YouFID', () => {
  it('programme : cadeaux de la route 2 et réglages de l’enseigne (défauts 1 pt/€, 100 bienvenue)', async () => {
    const { loyalty, store, fake } = setup();
    const program = await loyalty.getProgram(tenant);
    expect(program).toEqual({
      name: 'Club Test',
      pointsPerEuro: 1,
      welcomePoints: 100,
      source: 'youfid',
      rewards: [
        { id: '11', name: 'Frites offertes', costPoints: 300, productIds: [] },
        { id: '12', name: 'Boisson offerte', costPoints: 500, productIds: [] },
      ],
    });
    await store.saveProgramSettings(tenant.id, { pointsPerEuro: 1, welcomePoints: 0 });
    expect(await loyalty.getProgram(tenant)).toMatchObject({ pointsPerEuro: 1, welcomePoints: 0 });
    // Programme en cache : une seule lecture de la route 2.
    expect(fake.calls.filter((c) => c.route === 'marchandGetMerchantDetailsV2')).toHaveLength(1);
  });

  it('inscription avec un numéro au format national : envoyé et enregistré en +33 (E.164)', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Léa',
      email: null,
      phone: '06 12 34 56 78',
    });
    expect(member.phone).toBe('+33612345678');
    // YouFID compare les chaînes : le format national créerait un doublon (Splash360, 26/11).
    expect(fake.calls.find((c) => c.route === 'registerCustomerByPhone')?.body.phone).toBe(
      '+33612345678',
    );
    expect(fake.customers.some((c) => c.phone === '+33612345678')).toBe(true);
    await expect(
      loyalty.join(tenant, { name: 'Léa', email: null, phone: 'pas un numéro' }),
    ).rejects.toThrow();
  });

  it('inscription par SMS : client créé chez YouFID, QR code, prénom et bienvenue crédités', async () => {
    const { loyalty, fake, store } = setup();
    expect(await loyalty.findByPhone(tenant, '+33612345678')).toBeNull();
    // findByPhone ne crée rien chez YouFID avant l'acceptation des conditions.
    expect(fake.calls.some((c) => c.route === 'registerCustomerByPhone')).toBe(false);
    const { member, created } = await loyalty.join(tenant, {
      name: 'Léa',
      email: null,
      phone: '+33612345678',
    });
    expect(created).toBe(true);
    const yf = fake.customers.find((c) => c.phone === '+33612345678');
    // QR code d'un compte créé par téléphone : 8 chiffres commençant par 1, gardé en texte.
    expect(member.cardCode).toMatch(/^1\d{7}$/);
    expect(member).toEqual({
      id: String(yf?.usrId),
      name: 'Léa',
      email: null,
      phone: '+33612345678',
      points: 100,
      cardCode: yf?.qrCode,
      birthDate: null,
    });
    expect(yf?.prenom).toBe('Léa');
    const submit = fake.calls.find((c) => c.route === 'customerSubmitResponse');
    expect(submit?.body).toMatchObject({ question: { id: 7, type: 'NAME' }, response: 'Léa' });
    expect(await loyalty.findByPhone(tenant, '+33612345678')).toEqual(member);
    expect(await loyalty.getMember(tenant, member.id)).toEqual(member);
    expect(await loyalty.history(tenant, member.id)).toEqual([
      { kind: 'welcome', points: 100, label: 'Points de bienvenue', at: expect.any(String) },
    ]);
    expect((await store.getLink(tenant.id, member.id))?.qrCode).toBe(yf?.qrCode);
  });

  it('client déjà connu en magasin : retrouvé, sans prénom par défaut, bienvenue une seule fois', async () => {
    const { loyalty, fake, store } = setup();
    const yf = fake.addCustomer({ phone: '+33622222222', points: 420 });
    const join = () => loyalty.join(tenant, { name: 'Membre', email: null, phone: '+33622222222' });
    const { member, created } = await join();
    expect(created).toBe(false);
    expect(member).toMatchObject({ id: String(yf.usrId), points: 520, name: 'Camille Durand' });
    expect(fake.calls.some((c) => c.route === 'customerSubmitResponse')).toBe(false);
    const scans = () => fake.calls.filter((c) => c.route === 'marchandCheckScanUser').length;
    expect(scans()).toBe(1);
    // Nouvelle connexion, ou compte supprimé puis recréé : pas de seconde bienvenue.
    await join();
    await store.deleteLink(tenant.id, String(yf.usrId));
    expect((await join()).member.points).toBe(520);
    expect(scans()).toBe(1);
  });

  it('sans téléphone : un e-mail connu retrouve le client, sinon inscription refusée', async () => {
    const { loyalty, fake } = setup();
    const yf = fake.addCustomer({ phone: '+33633333333', email: 'zoe@example.fr' });
    const found = await loyalty.join(tenant, { name: 'Zoé', email: 'ZOE@example.fr', phone: null });
    expect(found).toMatchObject({ created: false, member: { id: String(yf.usrId) } });
    expect((await loyalty.findByEmail(tenant, 'zoe@example.fr'))?.phone).toBe('+33633333333');
    await expect(
      loyalty.join(tenant, { name: 'X', email: 'x@example.fr', phone: null }),
    ).rejects.toBeInstanceOf(LoyaltyUnsupportedError);
  });

  it('identifiant de membre inconnu ou mal formé : null', async () => {
    const { loyalty } = setup();
    expect(await loyalty.getMember(tenant, '999')).toBeNull();
    expect(await loyalty.getMember(tenant, '00000000-0000-4000-9000-000000000001')).toBeNull();
  });

  it('profil : prénom, e-mail et date de naissance envoyés (route 12), copie locale', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33644444444',
    });
    const r = await loyalty.updateProfile(tenant, member.id, {
      name: 'Inès',
      email: 'ines@example.fr',
      birthDate: '1990-04-12',
    });
    expect(r).toMatchObject({
      ok: true,
      member: { name: 'Inès', email: 'ines@example.fr', birthDate: '1990-04-12' },
    });
    const types = fake.calls
      .filter((c) => c.route === 'customerSubmitResponse')
      .map((c) => [
        (c.body.question as { type: string; id: number }).type,
        (c.body.question as { id: number }).id,
        c.body.response,
      ]);
    // Question en attente lue sur la route 3 (prénom encore vide chez YouFID) ; jamais la route 11.
    expect(types).toEqual([
      ['NAME', 7, 'Inès'],
      ['EMAIL', 0, 'ines@example.fr'],
      ['BIRTH', 0, '1990-04-12'],
    ]);
    expect(fake.calls.some((c) => c.route === 'customerGetOrUpdateSmsOptin')).toBe(false);
    // Question du prénom plus en attente : YouFID refuse (id 0), le prénom saisi reste affiché.
    const again = await loyalty.updateProfile(tenant, member.id, { name: 'Mohamed' });
    expect(again).toMatchObject({ ok: true, member: { name: 'Mohamed' } });
    expect((await loyalty.getMember(tenant, member.id))?.name).toBe('Mohamed');
    expect(await loyalty.updateProfile(tenant, '12345', { name: 'X' })).toEqual({
      ok: false,
      error: 'unknown_member',
    });
  });

  it('commande payée : cadeau (route 6) puis gain de notre règle en crédit forcé (route 5), une seule fois', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33655555555',
    });
    expect(member.points).toBe(100);
    await loyalty.adjustPoints(tenant, member.id, 250, 'Geste commercial');
    const s = order(member.id, 'o-1', { reward: true });
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: true });
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: true });
    expect((await loyalty.getMember(tenant, member.id))?.points).toBe(100 + 250 - 300 + 125);
    expect(fake.calls.filter((c) => c.route === 'transformToPresent')).toHaveLength(1);
    const scans = fake.calls.filter((c) => c.route === 'marchandCheckScanUser');
    // Gain de la commande calculé par la règle de l'enseigne et envoyé en crédit forcé ; le montant
    // (euros exacts) l'accompagne pour les statistiques du marchand. Bienvenue et correction :
    // crédit forcé seul.
    expect(scans.map((c) => c.body.forced_amount)).toEqual([100, 250, 125]);
    expect(scans.map((c) => c.body.amount)).toEqual([undefined, undefined, 12.5]);
    const transform = fake.calls.find((c) => c.route === 'transformToPresent');
    expect(transform?.body.products).toEqual([{ id: 11, cost: 300, name: 'Frites offertes' }]);
    const history = await loyalty.history(tenant, member.id);
    // Gain d'abord, puis cadeau (le plus récent en premier dans l'historique).
    expect(history.map((h) => [h.kind, h.points, h.label])).toEqual([
      ['redeem', -300, 'Récompense : Frites offertes'],
      ['earn', 125, 'Commande n° 1042'],
      ['adjust', 250, 'Geste commercial'],
      ['welcome', 100, 'Points de bienvenue'],
    ]);
  });

  it('gain avant le cadeau ; gain à 0 point signalé, cadeau quand même déduit, puis gain repris une fois', async () => {
    const { loyalty, fake, store } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33657575757',
    });
    await loyalty.adjustPoints(tenant, member.id, 250, 'Geste commercial');
    fake.state.zeroCreditAfterTransform = true;
    // Le crédit suivant est ignoré par YouFID (0 point) : ici, le gain de la commande.
    fake.state.lastWasTransform = true;
    const s = order(member.id, 'o-z', { reward: true });
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: false, error: 'provider_error' });
    const routes = fake.calls
      .map((c) => c.route)
      .filter((r) => r !== 'testmarchandCheckScanUserIfExistsV2');
    expect(routes.slice(-2)).toEqual(['marchandCheckScanUser', 'transformToPresent']);
    // Le cadeau reçu dans la commande est bien déduit, même sans gain.
    expect((await loyalty.getMember(tenant, member.id))?.points).toBe(100 + 250 - 300);
    expect((await store.operationsToReview(tenant.id, 20)).map((o) => o.error)).toContain(
      'not_credited',
    );
    // Règlement rejoué (webhook) : gain repris une seule fois, cadeau pas déduit deux fois.
    fake.state.zeroCreditAfterTransform = false;
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: true });
    expect((await loyalty.getMember(tenant, member.id))?.points).toBe(100 + 250 - 300 + 125);
    expect(fake.calls.filter((c) => c.route === 'transformToPresent')).toHaveLength(1);
  });

  it('deux règlements simultanés : un seul crédit', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33656565656',
    });
    fake.state.delayMs = 20;
    const s = order(member.id, 'o-c');
    const results = await Promise.all([
      loyalty.settleOrder(tenant, s),
      loyalty.settleOrder(tenant, s),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([{ ok: true }, { ok: false, error: 'in_progress' }]),
    );
    // Bienvenue (100) puis un seul gain de commande, malgré deux règlements simultanés.
    const scans = fake.calls.filter((c) => c.route === 'marchandCheckScanUser');
    expect(scans).toHaveLength(2);
  });

  it('cadeau sans assez de points : refusé sans appel à la route 6, puis repris plus tard', async () => {
    const { loyalty, fake, store } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33657575757',
    });
    const s = order(member.id, 'o-r', { reward: true });
    expect(await loyalty.settleOrder(tenant, s)).toEqual({
      ok: false,
      error: 'insufficient_points',
    });
    expect(fake.calls.some((c) => c.route === 'transformToPresent')).toBe(false);
    expect((await store.operationsToReview(tenant.id, 10)).map((o) => o.error)).toEqual([
      'insufficient_points',
    ]);
    await loyalty.adjustPoints(tenant, member.id, 500, 'Correction');
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: true });
  });

  it('coupure après envoi : opération « uncertain », jamais rejouée seule', async () => {
    const { loyalty, fake, store, logs } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33658585858',
    });
    fake.dropResponse('marchandCheckScanUser');
    const s = order(member.id, 'o-u');
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: false, error: 'uncertain' });
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: false, error: 'uncertain' });
    // Le crédit a bien eu lieu une fois chez YouFID, jamais deux.
    expect((await loyalty.getMember(tenant, member.id))?.points).toBe(225);
    const review = await store.operationsToReview(tenant.id, 10);
    expect(review).toMatchObject([
      { key: 'order:o-u:earn', status: 'uncertain', error: 'network' },
    ]);
    expect(logs.some((l) => l.message.includes('issue inconnue'))).toBe(true);
    expect(await store.resolveOperation(tenant.id, review[0]?.id ?? '')).toBe(true);
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: true });
  });

  it('serveur arrêté pendant l’appel : l’opération restée « pending » devient « uncertain »', async () => {
    const { loyalty, store, advance } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33659595959',
    });
    await store.claimOperation(tenant.id, {
      key: 'order:o-crash:earn',
      kind: 'earn',
      memberId: member.id,
      orderId: 'o-crash',
      points: 125,
      label: 'Commande n° 1042',
    });
    const s = order(member.id, 'o-crash');
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: false, error: 'in_progress' });
    advance(STALE_OPERATION_MS + 1000);
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: false, error: 'uncertain' });
    expect((await store.operationsToReview(tenant.id, 10))[0]?.error).toBe('interrupted');
  });

  it('refus explicite (status error) : « failed », retentable', async () => {
    const { loyalty, fake, store } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33660606060',
    });
    fake.once('marchandCheckScanUser', () => ({ json: { status: 'error', message: 'Erreur' } }));
    const s = order(member.id, 'o-f');
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: false, error: 'provider_error' });
    expect((await store.operationsToReview(tenant.id, 10))[0]?.status).toBe('failed');
    expect(await loyalty.settleOrder(tenant, s)).toEqual({ ok: true });
  });

  it('nombre de passages du jour atteint : échec signalé, pas ignoré', async () => {
    const { loyalty, fake, logs } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33661616161',
    });
    fake.state.maxScansReached = true;
    expect(await loyalty.settleOrder(tenant, order(member.id, 'o-m'))).toEqual({
      ok: false,
      error: 'daily_limit',
    });
    expect(await loyalty.adjustPoints(tenant, member.id, 50, 'Story')).toEqual({
      ok: false,
      error: 'daily_limit',
    });
    expect(logs.some((l) => l.message.includes('passages du jour'))).toBe(true);
  });

  it('plafond de solde (MAX_POINTS_REACHED) : refus « balance_cap », à vérifier, pas « daily_limit »', async () => {
    const { loyalty, fake, logs, store } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33663636363',
    });
    fake.state.balanceCap = 100;
    expect(await loyalty.settleOrder(tenant, order(member.id, 'o-cap'))).toEqual({
      ok: false,
      error: 'balance_cap',
    });
    expect(await loyalty.adjustPoints(tenant, member.id, 50, 'Geste')).toEqual({
      ok: false,
      error: 'balance_cap',
    });
    const review = await store.operationsToReview(tenant.id, 10);
    expect(review.map((o) => [o.status, o.error])).toEqual([
      ['failed', 'balance_cap'],
      ['failed', 'balance_cap'],
    ]);
    expect(logs.some((l) => l.message.includes('plafond de solde'))).toBe(true);
    expect((await loyalty.getMember(tenant, member.id))?.points).toBe(100);
  });

  it('MAX_SCAN_REACHED → daily_limit ; AMOUNT_TOO_HIGH → refus ; code vide = succès', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33664646464',
    });
    fake.state.maxAmount = 10;
    expect(await loyalty.settleOrder(tenant, order(member.id, 'o-big'))).toEqual({
      ok: false,
      error: 'amount_too_high',
    });
    fake.state.maxAmount = null;
    expect(await loyalty.settleOrder(tenant, order(member.id, 'o-ok'))).toEqual({ ok: true });
    expect((await loyalty.getMember(tenant, member.id))?.points).toBe(225);
  });

  it('cadeau refusé par la route 6 (erreur générique) : « redeem_failed », visible au back-office', async () => {
    const { loyalty, fake, store } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33665656565',
    });
    await loyalty.adjustPoints(tenant, member.id, 250, 'Geste');
    fake.state.withdrawFails = true;
    expect(await loyalty.settleOrder(tenant, order(member.id, 'o-w', { reward: true }))).toEqual({
      ok: false,
      error: 'redeem_failed',
    });
    const review = await store.operationsToReview(tenant.id, 10);
    expect(review.map((o) => [o.kind, o.status, o.error])).toEqual([
      ['redeem', 'failed', 'redeem_failed'],
    ]);
  });

  it('route 10 « Duplicated user » : erreur claire, sans plantage ni lien local', async () => {
    const { loyalty, fake, logs, store } = setup();
    fake.state.duplicatedUser = true;
    await expect(
      loyalty.join(tenant, { name: 'Léa', email: null, phone: '+33666666666' }),
    ).rejects.toBeInstanceOf(LoyaltyDuplicateCustomerError);
    expect(logs.some((l) => l.message.includes('Duplicated user'))).toBe(true);
    expect(await store.findLinkByPhone(tenant.id, '+33666666666')).toBeNull();
  });

  it('membre déjà lié : retrouvé par le lien local, sans nouvel appel à la route 10', async () => {
    const { loyalty, fake } = setup();
    await loyalty.join(tenant, { name: 'Léa', email: null, phone: '+33667676767' });
    const before = fake.calls.filter((c) => c.route === 'registerCustomerByPhone').length;
    expect(await loyalty.findByPhone(tenant, '+33667676767')).not.toBeNull();
    expect(fake.calls.filter((c) => c.route === 'registerCustomerByPhone')).toHaveLength(before);
  });

  it('la durée de validité des points (route 2) n’est jamais exposée : les points n’expirent pas', async () => {
    const { loyalty } = setup();
    const program = await loyalty.getProgram(tenant);
    expect(JSON.stringify(program)).not.toContain('validity');
    expect(program).not.toHaveProperty('validity');
  });

  it('bonus ambassadeur : forced_amount, une seule fois par clé ; retrait refusé', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33662626262',
    });
    const opts = { operationKey: 'ambassador:e-1', kind: 'bonus' as const };
    const a = await loyalty.adjustPoints(tenant, member.id, 80, 'Story Instagram', opts);
    const b = await loyalty.adjustPoints(tenant, member.id, 80, 'Story Instagram', opts);
    expect(a).toMatchObject({ ok: true, member: { points: 180 } });
    expect(b).toMatchObject({ ok: true, member: { points: 180 } });
    expect(fake.calls.filter((c) => c.body.forced_amount === 80)).toHaveLength(1);
    expect(await loyalty.adjustPoints(tenant, member.id, -10, 'Retrait')).toEqual({
      ok: false,
      error: 'unsupported',
    });
    expect(await loyalty.adjustPoints(tenant, '424242', 10, 'X')).toEqual({
      ok: false,
      error: 'unknown_member',
    });
  });

  it('back-office : liste des membres liés, recherche YouFID (route 7) et par téléphone', async () => {
    const { loyalty, fake } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33663636363',
    });
    const yf = fake.addCustomer({ phone: '+33664646464', nom: 'Bernard', points: 70 });
    expect((await loyalty.listMembers(tenant, null, 200)).map((m) => m.id)).toEqual([member.id]);
    const found = await loyalty.listMembers(tenant, 'bern', 200);
    expect(found).toMatchObject([{ id: String(yf.usrId), points: 70, cardCode: yf.qrCode }]);
    // Client retrouvé par la recherche : désormais consultable et créditable.
    expect((await loyalty.getMember(tenant, String(yf.usrId)))?.points).toBe(70);
    expect((await loyalty.listMembers(tenant, '06 63 63 63 63', 200)).map((m) => m.id)).toEqual([
      member.id,
    ]);
    expect(await loyalty.deleteMember(tenant, member.id)).toBe(true);
    expect(await loyalty.getMember(tenant, member.id)).toBeNull();
  });

  it('le PIN client n’apparaît ni dans les objets renvoyés ni dans le journal', async () => {
    const { loyalty, fake, logs } = setup();
    const { member } = await loyalty.join(tenant, {
      name: 'Léo',
      email: null,
      phone: '+33665656565',
    });
    fake.dropResponse('marchandCheckScanUser');
    const outputs = [
      member,
      await loyalty.getMember(tenant, member.id),
      await loyalty.listMembers(tenant, 'léo', 200),
      await loyalty.settleOrder(tenant, order(member.id, 'o-p')),
      await loyalty.history(tenant, member.id),
    ];
    expect(JSON.stringify(outputs)).not.toContain(FAKE_PIN);
    expect(JSON.stringify(logs)).not.toContain(FAKE_PIN);
    expect(JSON.stringify(logs)).not.toContain('0665656565');
  });
});

describe('aiguillage par enseigne et configuration', () => {
  it('YouFID pour les enseignes configurées, démonstration pour les autres', async () => {
    // Le registre utilise l'horloge réelle : le faux serveur aussi.
    const fake = createFakeYoufid({ now: Date.now });
    const registry = createYoufidRegistry({
      accounts: parseYoufidAccounts(
        JSON.stringify({ chickenstreet: { login: 'marchand', password: 'secret-de-test' } }),
      ),
      store: createMemoryYoufidStore(),
      random: () => 'r',
      fetch: fake.fetch,
    });
    const subdomains: Record<string, string> = { 't-chicken': 'chickenstreet', 't-bills': 'bills' };
    const routing = createRoutingLoyaltyProvider({
      resolve: (t) => Promise.resolve(registry.providerFor(subdomains[t.id] ?? '')),
      fallback: createDemoLoyaltyProvider(createMemoryDemoLoyaltyStore(), () => 'abc'),
    });
    expect((await routing.getProgram(tenant))?.source).toBe('youfid');
    expect(
      (await routing.getProgram({ id: 't-bills', splash360Id: 'S360-DEMO-BILLS' }))?.name,
    ).toBe('Le club Bill’s Burger');
    expect(registry.has('chickenstreet')).toBe(true);
    expect(registry.probe('inconnue')).toBeNull();
    expect(await registry.probe('chickenstreet')).toMatchObject({
      merchantId: 4242,
      secType: 'oauth1HmacSha256',
      rewards: 2,
      catalog: [
        { id: '11', name: 'Frites offertes', cost: 300 },
        { id: '12', name: 'Boisson offerte', cost: 500 },
      ],
    });
    expect(await noLoyaltyProvider.getProgram(tenant)).toBeNull();
  });

  it('YOUFID_ACCOUNTS : JSON validé, erreurs sans secret', () => {
    expect(parseYoufidAccounts(undefined).size).toBe(0);
    expect(parseYoufidAccounts('  ').size).toBe(0);
    const ok = parseYoufidAccounts('{"chickenstreet":{"login":"l","password":"p4ss"}}');
    expect(ok.get('chickenstreet')).toEqual({ login: 'l', password: 'p4ss' });
    expect(() => parseYoufidAccounts('{pas du json p4ss')).toThrow('JSON invalide');
    // Libellé ou adresse collés avant l'objet : seul l'objet est lu.
    const pasted = parseYoufidAccounts(
      'https://api-loyalty.splash360.fr/dev/service/\n{"chickenstreet":{"login":"l","password":"p:4ss"}}',
    );
    expect(pasted.get('chickenstreet')).toEqual({ login: 'l', password: 'p:4ss' });
    // L'aide au diagnostic décrit la forme de la saisie sans citer son contenu.
    try {
      parseYoufidAccounts('{pas du json p4ss');
    } catch (e) {
      expect((e as Error).message).toContain('longueur 17');
      expect((e as Error).message).not.toMatch(/p4ss|pas|json/);
    }
    // Saisie depuis un iPhone : guillemets typographiques remplacés automatiquement.
    const smart = parseYoufidAccounts(
      '\u201C'
        .concat(
          '{\u201Cchickenstreet\u201D:{\u201Clogin\u201D:\u201Cl\u201D,\u201Cpassword\u201D:\u201Cp4ss\u201D}}',
        )
        .slice(1),
    );
    expect(smart.get('chickenstreet')).toEqual({ login: 'l', password: 'p4ss' });
    let message = '';
    try {
      parseYoufidAccounts(
        '{"chickenstreet":{"login":"l"},"Pas Valide":{"login":"x","password":"p4ss"}}',
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('YOUFID_ACCOUNTS invalide');
    expect(message).not.toContain('p4ss');
  });

  it('identifiant d’appareil stable par environnement', () => {
    expect(youfidDeviceId(undefined, 'recette')).toBe('splash360-commande-recette');
    expect(youfidDeviceId(' borne-1 ', 'production')).toBe('borne-1');
    expect(youfidDeviceId('x'.repeat(150), 'production')).toHaveLength(100);
  });
});

describe('nom des paliers YouFID', () => {
  it('retire le coût saisi en fin de nom, déjà affiché par l’application', () => {
    expect(rewardLabel('Une boisson offerte (30 pts)')).toBe('Une boisson offerte');
    expect(rewardLabel('Un menu offert (100 points)')).toBe('Un menu offert');
    expect(rewardLabel('Frites offertes')).toBe('Frites offertes');
    expect(rewardLabel('(30 pts)')).toBe('(30 pts)');
  });
});
