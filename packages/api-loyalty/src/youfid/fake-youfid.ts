import { createHmac } from 'node:crypto';

/**
 * Faux serveur YouFID pour les tests (fetch injecté). Il applique les règles de la documentation :
 * signature HMAC-SHA256 sur corps + fid_client_id + nonce + timestamp, nonce à usage unique,
 * horodatage à ±300 s, fid_client_id = merchant_id du corps, ERR0401 en HTTP 200, statuts
 * « success » de la route 12, PIN client renvoyé en clair par les routes 3 et 5. Seules les routes
 * utilisées par l'application sont simulées (1, 2, 3, 5, 6, 7, 10, 12).
 */
export interface FakeCustomer {
  usrId: number;
  qrCode: string;
  /** Format national, comme sur la tablette. */
  phone: string;
  nom: string;
  prenom: string;
  points: number;
  pin: string;
  email: string | null;
}

type Body = Record<string, unknown>;
type Reply = { status?: number; json: unknown } | 'network' | 'html';

export const FAKE_MERCHANT_ID = 4242;
export const FAKE_PIN = '987654';

export function createFakeYoufid(options: { now: () => number }) {
  let keyHex = Buffer.from('0123456789abcdef'.repeat(4)).toString('hex');
  const nonces = new Set<string>();
  const customers: FakeCustomer[] = [];
  const calls: { route: string; body: Body; authorization: string | null; raw: string }[] = [];
  const overrides = new Map<string, ((body: Body) => Reply)[]>();
  let nextUsr = 100;
  let inits = 0;
  const state = {
    maxScansReached: false,
    secType: 'oauth1HmacSha256' as string,
    /** Attente simulée de chaque réponse (ms, sur un délai réel). */
    delayMs: 0,
    products: [
      { id: 12, cost: 500, name: 'Boisson offerte', type: 'GIFT' },
      { id: 11, cost: 300, name: 'Frites offertes', type: 'GIFT' },
    ],
  };

  const ok = (json: Body = {}) => ({ json: { status: 'ok', message: '', ...json } });
  const err = (message: string, code?: string, status = 200) => ({
    status,
    json: { status: 'error', message, ...(code ? { code } : {}) },
  });
  const byQr = (qr: unknown) => customers.find((c) => c.qrCode === qr);
  const byId = (id: unknown) => customers.find((c) => c.usrId === Number(id));
  const national = (p: string) => (p.startsWith('+33') ? `0${p.slice(3)}` : p);

  function verify(raw: string, body: Body, authorization: string | null): boolean {
    if (state.secType !== 'oauth1HmacSha256') return true;
    if (!authorization) return false;
    const parts = Object.fromEntries(
      authorization.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)];
      }),
    );
    const { fid_client_id: client, nonce, timestamp, sign } = parts;
    if (!client || !nonce || !timestamp || !sign) return false;
    if (Math.abs(Number(timestamp) - Math.floor(options.now() / 1000)) > 300) return false;
    if (nonces.has(nonce)) return false;
    if ('merchant_id' in body && String(body.merchant_id) !== client) return false;
    const expected = createHmac('sha256', Buffer.from(keyHex, 'hex'))
      .update(raw + client + nonce + timestamp)
      .digest('hex');
    if (expected !== sign) return false;
    nonces.add(nonce);
    return true;
  }

  function customerJson(c: FakeCustomer) {
    return {
      is_user: 1,
      ask_phone: 0,
      promo: 0,
      survey: 0,
      questions: 0,
      usr_id: c.usrId,
      qr_code: c.qrCode,
      nom: c.nom,
      prenom: c.prenom,
      phone: c.phone,
      is_pin_active: true,
      pin_code: c.pin,
      sms_optin: null,
      // Prochaine question de profil en attente (route 3), comme la tablette.
      profile_question: !c.prenom
        ? { id: 7, type: 'NAME', name: 'name', label: 'Prénom', rank: 1 }
        : !c.email
          ? { id: 8, type: 'EMAIL', name: 'email', label: 'E-mail', rank: 2 }
          : null,
      total_points: c.points,
      gifts: [],
    };
  }

  const routes: Record<string, (b: Body) => Reply> = {
    marchandInitMarchand(b) {
      inits += 1;
      if (b.login !== 'marchand' || b.password !== 'secret-de-test') {
        return err('Login ou mot de passe incorrect');
      }
      return ok({
        merchant_id: FAKE_MERCHANT_ID,
        loyalty_mode: '0',
        sec_type: state.secType,
        session_key: keyHex,
        session_key_expires_at: new Date(options.now() + 48 * 3600_000).toISOString(),
        session_key_expires_in: 48 * 3600,
      });
    },
    marchandGetMerchantDetailsV2: () =>
      ok({
        name: 'Chicken Test',
        logo: '',
        address: '1 rue Test, 75001, Paris',
        attribution_pts: '1',
        pin: '0000',
        is_pin_marchand: '0',
        is_promo: '0',
        categories: [],
        products: state.products,
        loyalty_program: { id: 1, name: 'Club Test', program_type: 'POINTS', validity: '12' },
      }),
    testmarchandCheckScanUserIfExistsV2(b) {
      const c =
        'qr_code' in b ? byQr(b.qr_code) : customers.find((x) => x.email && x.email === b.email);
      return c ? ok(customerJson(c)) : { json: { status: 'ko', is_user: 0 } };
    },
    marchandCheckScanUser(b) {
      const c = byQr(b.qr_code);
      if (!c) return err('Utilisateur introuvable');
      if (state.maxScansReached) {
        return ok({
          usr_id: c.usrId,
          won_pts: 0,
          total_pts: c.points,
          maximum_scans_reached: '1',
          pin_user: c.pin,
        });
      }
      const won =
        typeof b.forced_amount === 'number'
          ? b.forced_amount
          : typeof b.amount === 'number'
            ? b.amount > 4000
              ? 0
              : Math.floor(b.amount * 10)
            : 5;
      c.points += won;
      return ok({
        usr_id: c.usrId,
        last_name: c.nom,
        first_name: c.prenom,
        fid_status: 'MEMBER',
        won_pts: won,
        total_pts: c.points,
        maximum_scans_reached: '0',
        pin_user: c.pin,
        ask_phone: 0,
      });
    },
    transformToPresent(b) {
      const c = byId(b.usr_id);
      if (!c) return err('Utilisateur introuvable');
      const cost = (b.products as { cost: number }[]).reduce((s, p) => s + p.cost, 0);
      if (c.points < cost) return err('Points insuffisants');
      c.points -= cost;
      return ok({ total_pts: c.points });
    },
    marchandListUsersV2(b) {
      const q = String(b.usr_input).toLowerCase();
      return ok({
        users: customers
          .filter((c) => [c.nom, c.prenom, c.email ?? ''].some((v) => v.toLowerCase().includes(q)))
          .map((c) => ({
            usr_id: c.usrId,
            first_name: c.prenom,
            last_name: c.nom,
            email: c.email,
            photo: '',
            qr_code: c.qrCode,
          })),
      });
    },
    registerCustomerByPhone(b) {
      if (!b.phone) return err('phone manquant', 'ERR0400', 400);
      const phone = String(b.phone);
      const existing = customers.find((c) => c.phone === phone);
      const c =
        existing ??
        (() => {
          nextUsr += 1;
          const created: FakeCustomer = {
            usrId: nextUsr,
            qrCode: `QR${String(nextUsr)}XYZ`,
            phone,
            nom: '',
            prenom: '',
            points: 0,
            pin: FAKE_PIN,
            email: null,
          };
          customers.push(created);
          return created;
        })();
      return ok({
        usr_id: c.usrId,
        qr_code: c.qrCode,
        ...(existing ? { phone: c.phone } : {}),
        total_points: c.points,
        gifts: [],
        sms_optin: null,
        profile_question: { id: 7, type: 'NAME', name: 'name', label: 'Prénom', rank: 1 },
      });
    },
    customerSubmitResponse(b) {
      const c = byId(b.user_id);
      if (!c) return { json: { status: 'error', message: 'User not found' } };
      const q = b.question as { type: string };
      if (!b.response) return err('Réponse vide', 'ERR0400', 400);
      if (q.type === 'NAME') c.prenom = String(b.response);
      if (q.type === 'EMAIL') c.email = String(b.response);
      return { json: { status: 'success', message: 'OK' } };
    },
  };

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = /\/([A-Za-z0-9]+)\.php$/.exec(url)?.[1] ?? '';
    const raw = typeof init?.body === 'string' ? init.body : '';
    const body = JSON.parse(raw || '{}') as Body;
    const headers = new Headers(init?.headers);
    const authorization = headers.get('Authorization');
    calls.push({ route, body, authorization, raw });
    if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
    const scripted = overrides.get(route)?.shift();
    let reply: Reply;
    if (scripted) {
      reply = scripted(body);
    } else if (route !== 'marchandInitMarchand' && !verify(raw, body, authorization)) {
      reply = { json: { status: 'error', message: 'Not authorized', code: 'ERR0401' } };
    } else {
      const handler = routes[route];
      reply = handler ? handler(body) : err('Route inconnue', 'ERR0404', 404);
    }
    if (reply === 'network') throw new TypeError('fetch failed');
    if (reply === 'html') return new Response('<html>500</html>', { status: 500 });
    return new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    state,
    calls,
    customers,
    get inits() {
      return inits;
    },
    /** Nouvelle clé : l'ancienne est refusée (ERR0401). */
    rotateKey() {
      keyHex = Buffer.from('fedcba9876543210'.repeat(4)).toString('hex');
    },
    /** Réponse imposée pour le prochain appel de cette route (après vérification éventuelle). */
    once(route: string, reply: (body: Body) => Reply) {
      overrides.set(route, [...(overrides.get(route) ?? []), reply]);
    },
    /** Applique la route normalement puis simule une coupure avant la réponse. */
    dropResponse(route: string) {
      this.once(route, (b) => {
        routes[route]?.(b);
        return 'network';
      });
    },
    addCustomer(c: Partial<FakeCustomer> & { phone: string }) {
      nextUsr += 1;
      const created: FakeCustomer = {
        usrId: nextUsr,
        qrCode: `QR${String(nextUsr)}XYZ`,
        nom: 'Durand',
        prenom: 'Camille',
        points: 0,
        pin: FAKE_PIN,
        email: null,
        ...c,
        phone: national(c.phone),
      };
      customers.push(created);
      return created;
    },
  };
}

export type FakeYoufid = ReturnType<typeof createFakeYoufid>;
