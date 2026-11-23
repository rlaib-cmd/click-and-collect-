import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import {
  loyaltyProgramSchema,
  loyaltySessionSchema,
  otpStartResponseSchema,
} from '@splash360/contracts';
import { createMemoryOtpStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import {
  createOtpDeps,
  createSmsSender,
  otpDebugEchoAllowed,
  type SmsSender,
} from '../loyalty/otp';
import { testSetup } from '../test-fixtures';

const programs = new Map<string, LoyaltyProgram>([
  ['S360-DEMO-BELLA', { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 100, rewards: [] }],
]);

function setup(
  options: { debugEcho?: boolean; environment?: string; smsConfigured?: boolean } = {},
) {
  let clock = new Date('2026-11-23T10:00:00Z');
  const now = () => clock;
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const sent: { to: string; sender: string; text: string }[] = [];
  const sms: SmsSender = {
    configured: options.smsConfigured ?? true,
    send(to, sender, text) {
      sent.push({ to, sender, text });
      return Promise.resolve();
    },
  };
  const mails: { to: string; subject: string }[] = [];
  let seed = 0;
  const otp = createOtpDeps({
    store: createMemoryOtpStore(now),
    sms,
    notifier: {
      email(to, m) {
        mails.push({ to, subject: m.subject });
        return Promise.resolve();
      },
    },
    emailConfigured: true,
    baseSecret: 'secret-de-test-0123456789abcdefghij',
    debugEcho: options.debugEcho ?? false,
    environment: options.environment ?? 'recette',
    randomBytes: () => new Uint8Array([0, 1, (seed += 7), 64]),
    log: () => undefined,
    now,
  });
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  const s = testSetup({ loyalty, otp, loyaltyDemoLogin: false });
  const lastCode = () => /^(\d{6})/.exec(sent.at(-1)?.text ?? '')?.[1] ?? '';
  return { ...s, sent, mails, advance, lastCode };
}

const base = '/v1/tenants/bella';
const post = (
  s: { app: { request: (u: string, i: RequestInit) => Response | Promise<Response> } },
  path: string,
  body: unknown,
) =>
  s.app.request(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('connexion par code (lot 10)', () => {
  it('annonce la connexion par code et ferme l’inscription sans vérification', async () => {
    const s = setup();
    const program = loyaltyProgramSchema.parse(
      await (await s.app.request(`${base}/loyalty/program`)).json(),
    );
    expect(program).toMatchObject({ enabled: true, otp: true, demo: false });
    const join = await post(s, '/loyalty/join', {
      name: 'Camille',
      email: 'c@example.fr',
      phone: null,
      acceptedTerms: true,
    });
    expect(join.status).toBe(404);
  });

  it('nouveau client : code par SMS, prénom demandé, compte créé avec ses points', async () => {
    const s = setup();
    const start = await post(s, '/loyalty/otp/start', {
      channel: 'sms',
      identifier: '06 00 00 00 01',
    });
    expect(start.status).toBe(202);
    const body = otpStartResponseSchema.parse(await start.json());
    expect(body).toEqual({ sent: true, identifier: '+33600000001', resendInSeconds: 60 });
    expect(s.sent[0]).toMatchObject({ to: '+33600000001', sender: 'PizzeriaBel' });
    const code = s.lastCode();
    expect(code).toMatch(/^\d{6}$/);

    const ask = await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '+33600000001',
      code,
    });
    expect(await ask.json()).toEqual({ needsName: true });

    const done = await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '0600000001',
      code,
      name: 'Sam',
      acceptedTerms: true,
    });
    expect(done.status).toBe(201);
    const session = loyaltySessionSchema.parse(await done.json());
    expect(session.member).toMatchObject({ name: 'Sam', phone: '+33600000001', points: 100 });

    // Usage unique : le même code ne rouvre pas de session.
    const replay = await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '+33600000001',
      code,
    });
    expect(replay.status).toBe(410);
  });

  it('client existant : retrouve son compte et ses points avec un nouveau code', async () => {
    const s = setup();
    await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000002' });
    await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '0600000002',
      code: s.lastCode(),
      name: 'Lou',
      acceptedTerms: true,
    });
    s.advance(61_000);
    await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '+33 6 00 00 00 02' });
    const login = await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '0600000002',
      code: s.lastCode(),
    });
    expect(login.status).toBe(200);
    expect(loyaltySessionSchema.parse(await login.json()).member.name).toBe('Lou');
  });

  it('refuse un mauvais code, puis bloque le code après 5 essais', async () => {
    const s = setup();
    await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000003' });
    const good = s.lastCode();
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const r = await post(s, '/loyalty/otp/verify', {
        channel: 'sms',
        identifier: '0600000003',
        code: wrong,
      });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('otp_invalid');
    }
    const late = await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '0600000003',
      code: good,
    });
    expect(late.status).toBe(410);
  });

  it('code expiré après 10 minutes', async () => {
    const s = setup();
    await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000004' });
    s.advance(10 * 60_000 + 1000);
    const r = await post(s, '/loyalty/otp/verify', {
      channel: 'sms',
      identifier: '0600000004',
      code: s.lastCode(),
    });
    expect(r.status).toBe(410);
  });

  it('limite les envois : 60 s entre deux codes, 5 par heure', async () => {
    const s = setup();
    const send = () => post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000005' });
    expect((await send()).status).toBe(202);
    const tooSoon = await send();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.headers.get('Retry-After')).toBe('60');
    for (let i = 0; i < 4; i += 1) {
      s.advance(61_000);
      expect((await send()).status).toBe(202);
    }
    s.advance(61_000);
    expect((await send()).status).toBe(429);
    expect(s.sent).toHaveLength(5);
  });

  it('refuse un numéro qui n’est pas un mobile français', async () => {
    const s = setup();
    for (const identifier of ['01 23 45 67 89', '+44 7700 900123', 'abc']) {
      const r = await post(s, '/loyalty/otp/start', { channel: 'sms', identifier });
      expect(r.status).toBe(400);
    }
    expect(s.sent).toHaveLength(0);
  });

  it('code par e-mail : même parcours', async () => {
    const s = setup();
    const r = await post(s, '/loyalty/otp/start', {
      channel: 'email',
      identifier: 'Jo@Example.fr',
    });
    expect(otpStartResponseSchema.parse(await r.json()).identifier).toBe('jo@example.fr');
    const code = /^(\d{6})/.exec(s.mails[0]?.subject ?? '')?.[1] ?? '';
    const done = await post(s, '/loyalty/otp/verify', {
      channel: 'email',
      identifier: 'jo@example.fr',
      code,
      name: 'Jo',
      acceptedTerms: true,
    });
    expect(loyaltySessionSchema.parse(await done.json()).member).toMatchObject({
      email: 'jo@example.fr',
      phone: null,
    });
  });

  it('ne renvoie le code dans la réponse qu’en recette sans prestataire', async () => {
    const recette = setup({ debugEcho: true, smsConfigured: false });
    const r = otpStartResponseSchema.parse(
      await (
        await post(recette, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000006' })
      ).json(),
    );
    expect(r.debugCode).toBe(recette.lastCode());

    for (const s of [
      setup({ debugEcho: true, smsConfigured: true }),
      setup({ debugEcho: true, smsConfigured: false, environment: 'production' }),
      setup({ debugEcho: false, smsConfigured: false }),
    ]) {
      const body = otpStartResponseSchema.parse(
        await (
          await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000006' })
        ).json(),
      );
      expect(body.debugCode).toBeUndefined();
    }
  });

  it('sans connexion par code, les routes n’existent pas', async () => {
    const s = testSetup();
    expect(
      (await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: '0600000001' })).status,
    ).toBe(404);
  });
});

describe('garde-fous', () => {
  it('otpDebugEchoAllowed', () => {
    expect(
      otpDebugEchoAllowed({ flag: true, environment: 'recette', providerConfigured: false }),
    ).toBe(true);
    expect(
      otpDebugEchoAllowed({ flag: true, environment: 'production', providerConfigured: false }),
    ).toBe(false);
    expect(
      otpDebugEchoAllowed({ flag: true, environment: 'recette', providerConfigured: true }),
    ).toBe(false);
    expect(
      otpDebugEchoAllowed({ flag: false, environment: 'recette', providerConfigured: false }),
    ).toBe(false);
  });

  it('SMS Brevo : numéro sans « + », type transactionnel, clé en en-tête', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = createSmsSender({
      brevoApiKey: 'cle-de-test-brevo',
      log: () => undefined,
      fetchImpl: (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Promise.resolve(new Response('{"messageId":1}', { status: 201 }));
      },
    });
    await sender.send('+33600000001', 'BillsBurger', '123456 est ton code');
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/transactionalSMS/send');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      sender: 'BillsBurger',
      recipient: '33600000001',
      type: 'transactional',
    });
    expect((calls[0]?.init.headers as Record<string, string>)['api-key']).toBe('cle-de-test-brevo');
  });

  it('SMS sans clé : journalisé, numéro masqué', async () => {
    const logs: unknown[] = [];
    const sender = createSmsSender({ log: (m, d) => logs.push({ m, d }) });
    expect(sender.configured).toBe(false);
    await sender.send('+33600000001', 'X', 'code');
    expect(JSON.stringify(logs)).not.toContain('600000001');
  });
});
