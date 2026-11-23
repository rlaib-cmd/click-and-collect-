/* global process, console, setTimeout, fetch, URL, window */
// Tests de bout en bout « back-office ↔ application client » sur la recette (lot 13).
// Les deux interfaces parlent à la vraie API de recette ; on vérifie qu'une action faite d'un
// côté se voit de l'autre. Mode d'emploi : e2e/README.md. Aucun identifiant n'est écrit ici :
// le mot de passe des comptes de test vient de la variable E2E_PASSWORD.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PASSWORD = process.env.E2E_PASSWORD;
const ADMIN = (process.env.ADMIN_URL ?? 'http://localhost:4466').replace(/\/+$/, '');
const APP = (process.env.APP_URL ?? 'http://localhost:4455').replace(/\/+$/, '');
const API = (
  process.env.API_URL ?? 'https://yfrvtrebukdbxnuqhlfy.supabase.co/functions/v1/api'
).replace(/\/+$/, '');
const PUBLIC_APP = (process.env.PUBLIC_APP_URL ?? 'https://claude-splash360.expo.app').replace(
  /\/+$/,
  '',
);
const SHOTS = process.env.E2E_SHOTS ?? 'e2e/screenshots';
const ONLY = (process.env.E2E_ONLY ?? 'a,b,c,d,e').split(',');
const TENANT = 'billsburger';
const RESTAURANT = '7cb95cb9-a290-46be-95b5-7720ffbf27b2';

if (!PASSWORD) {
  console.error('E2E_PASSWORD manquant : mot de passe des comptes de test de la recette.');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const results = [];
const cleanups = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(label, fn, timeoutMs = 120_000, everyMs = 5_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn().catch((e) => e);
    if (last === true) return;
    await sleep(everyMs);
  }
  throw new Error(`${label} : délai dépassé (${String(last)})`);
}

const json = async (path) => {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function scenario(id, title, fn) {
  if (!ONLY.includes(id)) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ id, title, ok: true, s: Math.round((Date.now() - started) / 1000) });
    console.log(`✓ (${id}) ${title}`);
  } catch (e) {
    let i = 0;
    for (const context of browser.contexts())
      for (const page of context.pages()) await shot(page, `${id}-echec-${(i += 1)}`);
    results.push({ id, title, ok: false, error: e.message.split('\n')[0] });
    console.log(`✗ (${id}) ${title} — ${e.message.split('\n')[0]}`);
  }
}

const browser = await chromium.launch();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});

async function adminLogin(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/(accueil|commandes|enseignes)/, { timeout: 30_000 });
  await page.getByRole('navigation', { name: 'Navigation du studio' }).waitFor();
  return page;
}

const navLabels = async (page) =>
  (
    await page
      .getByRole('navigation', { name: 'Navigation du studio' })
      .getByRole('link')
      .allInnerTexts()
  ).map((s) => s.trim());

async function appPage() {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  return context.newPage();
}

/**
 * Inscription d'un nouveau membre par code (la recette affiche le code à l'écran). Un numéro neuf
 * à chaque passage : les envois de code sont limités par numéro (ADR 0012).
 */
async function memberLogin(page) {
  const phone = `06${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  await page.goto(`${APP}/?enseigne=${TENANT}`);
  await page.getByRole('tab', { name: 'Carte VIP' }).click();
  await page.getByLabel('Numéro de mobile').first().fill(phone);
  await page
    .getByRole('button', { name: /Recevoir mon code/i })
    .first()
    .click();
  const text = await page
    .getByText(/code de test/)
    .first()
    .innerText({ timeout: 20_000 });
  await page.getByLabel('Code à 6 chiffres').first().fill(text.match(/\d{6}/)[0]);
  await page.getByPlaceholder('Prénom').first().fill('Test E2E');
  await page.getByRole('switch').first().click();
  await page
    .getByRole('button', { name: /Créer mon compte/i })
    .first()
    .click();
  await page
    .getByText(/MEMBRE VIP/i)
    .first()
    .waitFor({ timeout: 20_000 });
}

/** Panier avec un burger, jusqu'au récapitulatif. */
async function burgerToCheckout(page) {
  await page.goto(`${APP}/r/${RESTAURANT}?enseigne=${TENANT}`);
  await page
    .getByRole('button', { name: /^Bills Original/i })
    .first()
    .click();
  await page.getByRole('radio', { name: /2 steaks/ }).click();
  await page.getByRole('radio', { name: /Burger seul/ }).click();
  await page.getByRole('button', { name: /Ajouter ·/ }).click();
  await page
    .getByText(/voir le panier/i)
    .last()
    .click();
  await page
    .getByRole('button', { name: /continuer/i })
    .last()
    .click();
  await page
    .getByText(/^Total$/)
    .first()
    .waitFor({ timeout: 20_000 });
}

try {
  // (e) Rôles : chaque compte ne voit que ce que la matrice lui donne.
  await scenario('e', 'Rôles : équipier, gérant, propriétaire, super-admin', async () => {
    const staff = await adminLogin('equipier@billsburger.test');
    const s = await navLabels(staff);
    await shot(staff, 'e1-equipier');
    if (s.join('|') !== 'Commandes|Carte et produits')
      throw new Error(`équipier : ${s.join(', ')}`);
    await staff.context().close();

    const manager = await adminLogin('gerant@billsburger.test');
    const m = await navLabels(manager);
    await shot(manager, 'e2-gerant');
    if (m.includes('Paiement') || m.includes('Équipe et accès') || !m.includes('Apparence'))
      throw new Error(`gérant : ${m.join(', ')}`);
    await manager.context().close();

    const owner = await adminLogin('proprietaire@billsburger.test');
    const o = await navLabels(owner);
    if (!o.includes('Paiement') || !o.includes('Équipe et accès'))
      throw new Error(`propriétaire : ${o.join(', ')}`);
    await owner.goto(`${ADMIN}/equipe`);
    await owner.getByRole('heading', { name: 'Inviter quelqu’un' }).waitFor();
    await owner.getByTestId('member-gerant@billsburger.test').waitFor();
    await shot(owner, 'e3-proprietaire-equipe');
    await owner.context().close();

    // Super-admin : bloquer Chicken Street se voit dans l'application, puis débloquer.
    const admin = await adminLogin('admin@splash360.test');
    await admin.getByTestId('tenant-chickenstreet').waitFor();
    await shot(admin, 'e4-console');
    const row = admin.getByTestId('tenant-chickenstreet');
    const unblock = async () => {
      if ((await json('/v1/tenants/chickenstreet/config')).status === 200) return;
      admin.once('dialog', (d) => void d.accept());
      await row.getByRole('button', { name: 'Débloquer' }).click();
    };
    cleanups.push(unblock);
    admin.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Bloquer' }).click();
    await poll(
      'enseigne bloquée côté API',
      async () => (await json('/v1/tenants/chickenstreet/config')).status === 403,
      60_000,
      3_000,
    );
    // La configuration publique est mise en cache une minute : l'app le voit dans la minute.
    const app = await appPage();
    await poll('application bloquée', async () => {
      await app.goto(`${APP}/?enseigne=chickenstreet`);
      return app
        .getByText(/momentanément indisponible/)
        .waitFor({ timeout: 8_000 })
        .then(() => true);
    });
    await shot(app, 'e5-app-bloquee');
    await row.getByRole('button', { name: 'Débloquer' }).waitFor();
    admin.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Débloquer' }).click();
    await poll(
      'enseigne débloquée',
      async () => (await json('/v1/tenants/chickenstreet/config')).status === 200,
      60_000,
      3_000,
    );
    await poll('application rouverte', async () => {
      await app.goto(`${APP}/?enseigne=chickenstreet`);
      return app
        .getByRole('tab', { name: 'Commander' })
        .waitFor({ timeout: 8_000 })
        .then(() => true);
    });
    await app.context().close();

    // « Voir comme le client » ouvre le studio de l'enseigne avec le bandeau.
    await admin
      .getByTestId('tenant-billsburger')
      .getByRole('button', { name: 'Voir comme le client' })
      .click();
    await admin.getByText(/Tu vois le studio de Bills Burger/).waitFor({ timeout: 20_000 });
    await shot(admin, 'e6-voir-comme-le-client');
    await admin.context().close();
  });

  // (a) Apparence : brouillon → aperçu dans la vraie app → publication → l'app change.
  await scenario('a', 'Apparence : brouillon, aperçu dans l’app, publication, retour', async () => {
    const before = (await json(`/v1/tenants/${TENANT}/config`)).body.theme;
    const page = await adminLogin('gerant@billsburger.test');
    await page.goto(`${ADMIN}/design`);
    const club = page.getByRole('radiogroup', { name: 'Couleur du club fidélité' });
    await club.getByRole('radio', { name: 'Violet' }).click();
    await page.getByText(/Brouillon enregistré/).waitFor({ timeout: 15_000 });
    await shot(page, 'a1-brouillon');

    const restore = async () => {
      const live = (await json(`/v1/tenants/${TENANT}/config`)).body.theme;
      if ((live.loyaltyColor ?? null) === (before.loyaltyColor ?? null)) return;
      await page.goto(`${ADMIN}/design`);
      await page.getByRole('radio', { name: 'Comme la couleur principale' }).click();
      await page.getByText(/Brouillon enregistré/).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Publier', exact: true }).click();
      await page.getByRole('button', { name: 'Publier maintenant' }).click();
    };
    cleanups.push(restore);

    await page.getByRole('button', { name: 'Voir sur mon téléphone' }).click();
    const link = page.getByRole('link', { name: 'Voir dans la vraie application' });
    await link.waitFor({ timeout: 20_000 });
    const href = (await link.getAttribute('href')).replace(PUBLIC_APP, APP);
    await shot(page, 'a2-qr');
    const token = new URL(href).searchParams.get('preview');
    const preview = (
      await json(`/v1/tenants/${TENANT}/config?preview=${encodeURIComponent(token)}`)
    ).body;
    if (preview.theme.loyaltyColor !== '#7C3AED')
      throw new Error(`aperçu API : ${preview.theme.loyaltyColor}`);
    const app = await appPage();
    await app.goto(href);
    await app.getByText('Aperçu du brouillon — non publié').waitFor({ timeout: 20_000 });
    await shot(app, 'a3-app-apercu');
    if ((await json(`/v1/tenants/${TENANT}/config`)).body.theme.loyaltyColor === '#7C3AED')
      throw new Error('le brouillon est visible des clients avant publication');

    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: 'Publier', exact: true }).click();
    await page.getByText('Couleur du club fidélité').last().waitFor();
    await shot(page, 'a4-publier');
    await page.getByRole('button', { name: 'Publier maintenant' }).click();
    await page.getByText(/Publié · tes clients/).waitFor({ timeout: 20_000 });
    await poll(
      'couleur publiée visible par l’app',
      async () =>
        (await json(`/v1/tenants/${TENANT}/config`)).body.theme.loyaltyColor === '#7C3AED',
    );
    await app.goto(`${APP}/?enseigne=${TENANT}`);
    await app.getByRole('tab', { name: 'Carte VIP' }).click();
    await sleep(2000);
    await shot(app, 'a5-app-publiee');
    await app.context().close();

    await restore();
    cleanups.pop();
    await poll(
      'retour à la couleur d’origine',
      async () =>
        ((await json(`/v1/tenants/${TENANT}/config`)).body.theme.loyaltyColor ?? null) ===
        (before.loyaltyColor ?? null),
    );
    await page.context().close();
  });

  // (b) Carte : un produit mis en pause disparaît de l'application, puis revient.
  await scenario('b', 'Carte : pause d’un produit visible dans l’app', async () => {
    const page = await adminLogin('gerant@billsburger.test');
    await page.goto(`${ADMIN}/carte`);
    const pause = page.getByRole('button', { name: 'Mettre en pause : Bills Smoke' });
    await pause.waitFor({ timeout: 20_000 });
    const names = async () =>
      (await json(`/v1/tenants/${TENANT}/restaurants/${RESTAURANT}/menu`)).body.categories.flatMap(
        (c) => c.products.map((p) => p.name),
      );
    const resume = async () => {
      const button = page.getByRole('button', { name: 'Remettre en vente : Bills Smoke' });
      if (await button.isVisible().catch(() => false)) await button.click();
    };
    cleanups.push(resume);
    await pause.click();
    await page.getByRole('button', { name: 'Remettre en vente : Bills Smoke' }).waitFor();
    await shot(page, 'b1-pause');
    await poll('produit masqué dans l’app', async () => !(await names()).includes('Bills Smoke'));
    const app = await appPage();
    await app.goto(`${APP}/r/${RESTAURANT}?enseigne=${TENANT}`);
    await app
      .getByRole('button', { name: /^Bills Original/i })
      .first()
      .waitFor({ timeout: 20_000 });
    if (await app.getByRole('button', { name: /^Bills Smoke/i }).count())
      throw new Error('Bills Smoke encore visible');
    await shot(app, 'b2-app-sans-produit');
    await resume();
    cleanups.pop();
    await poll('produit de retour', async () => (await names()).includes('Bills Smoke'));
    await app.context().close();
    await page.context().close();
  });

  // (c) + (d) : code promo créé au back-office, accepté par l'app ; commande sur place suivie
  // des deux côtés jusqu'à la remise, points crédités.
  const member = ONLY.includes('c') || ONLY.includes('d') ? await appPage() : null;
  if (member) await memberLogin(member);
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`;

  await scenario('c', 'Code promo créé au back-office, accepté au récapitulatif', async () => {
    const page = await adminLogin('gerant@billsburger.test');
    await page.goto(`${ADMIN}/codes-promo`);
    await page.getByPlaceholder('Code').fill(code);
    await page.getByLabel('Type').selectOption('fixed');
    await page.getByLabel('Remise (€)').fill('2');
    await page.getByRole('button', { name: 'Créer un code' }).click();
    await page.getByRole('cell', { name: code }).waitFor({ timeout: 15_000 });
    await shot(page, 'c1-code-cree');
    const deactivate = async (on = page) => {
      await on.goto(`${ADMIN}/codes-promo`);
      const row = on.getByRole('row').filter({ hasText: code });
      const b = row.getByRole('button', { name: 'Désactiver' });
      await b.waitFor({ timeout: 15_000 });
      await b.click();
      await row.getByRole('button', { name: 'Réactiver' }).waitFor({ timeout: 15_000 });
    };
    const cleanup = async () => {
      const again = await adminLogin('gerant@billsburger.test');
      await deactivate(again).catch(() => {});
      await again.context().close();
    };
    cleanups.push(cleanup);

    await burgerToCheckout(member);
    await member.getByPlaceholder('Ex. BIENVENUE').fill(code);
    await member.getByRole('button', { name: /^Appliquer$/ }).click();
    await member.getByText(`Code promo ${code}`).waitFor({ timeout: 20_000 });
    await shot(member, 'c2-app-code-applique');
    // Code désactivé au back-office : l'app le refuse ensuite.
    await deactivate();
    cleanups.pop();
    await shot(page, 'c3-code-desactive');
    await page.context().close();
  });

  await scenario('d', 'Commande sur place : app → back-office → statut et points', async () => {
    if (
      !(await member
        .getByText(/^Total$/)
        .first()
        .isVisible()
        .catch(() => false))
    )
      await burgerToCheckout(member);
    const terms = member.getByRole('switch', { name: /conditions générales de vente/ });
    if ((await terms.getAttribute('aria-checked')) !== 'true') await terms.click();
    await member.getByRole('button', { name: /^Commander · / }).click();
    // Si le code du scénario (c) est resté au récapitulatif, il vient d'être désactivé :
    // l'app doit le refuser avec un message clair, le retirer, puis laisser commander.
    const refused = member.getByText('Ce code promo n’existe pas ou n’est plus actif.').first();
    const outcome = await Promise.race([
      member.waitForURL(/order/, { timeout: 30_000 }).then(() => 'order'),
      refused.waitFor({ timeout: 30_000 }).then(() => 'refused'),
    ]);
    if (outcome === 'refused') {
      await shot(member, 'd0-app-code-desactive-refuse');
      await member.getByRole('button', { name: /^Commander · / }).click();
      await member.waitForURL(/order/, { timeout: 30_000 });
    }
    const heading = await member
      .getByText(/Commande n° \d+/)
      .first()
      .innerText({ timeout: 20_000 });
    const number = heading.match(/\d+/)[0];
    await shot(member, 'd1-app-commande');

    const page = await adminLogin('gerant@billsburger.test');
    await page.goto(`${ADMIN}/commandes`);
    const card = page.getByRole('button', { name: new RegExp(`n° ${number}`) });
    await card.waitFor({ timeout: 30_000 });
    await shot(page, 'd2-backoffice-commande');
    await card.click();
    const drawer = page.getByRole('complementary', { name: `Commande n° ${number}` });
    // Le statut affiché en tête du suivi (en plus de l'étape de la frise) : deux fois le libellé.
    const appShows = (label) =>
      poll(
        `l’app affiche « ${label} »`,
        async () => {
          await member.reload();
          await member
            .getByText(/Commande n° \d+/)
            .first()
            .waitFor({ timeout: 15_000 });
          return (await member.getByText(label, { exact: true }).count()) >= 2;
        },
        90_000,
        3_000,
      );
    const steps = [
      ['Accepter', 'Acceptée par le restaurant', 'd3-app-acceptee'],
      ['Prête', 'Prête', 'd4-app-prete'],
      ['Remise', 'Remise', 'd5-app-remise'],
    ];
    for (const [action, label, name] of steps) {
      const b = drawer.getByRole('button', { name: action, exact: true });
      await b.waitFor({ timeout: 20_000 });
      await b.click();
      await (label === 'Acceptée par le restaurant'
        ? poll(
            'acceptée',
            async () => {
              await member.reload();
              return member
                .getByText(label)
                .first()
                .waitFor({ timeout: 10_000 })
                .then(() => true);
            },
            90_000,
            3_000,
          )
        : appShows(label));
      await shot(member, name);
    }

    // Points crédités à la remise (paiement sur place, ADR 0010), lus par l'API du membre.
    const token = await member.evaluate(
      (key) => window.localStorage.getItem(key),
      `splash360:fidelite:${TENANT}`,
    );
    if (!token) throw new Error('jeton de membre introuvable');
    await poll(
      'points de la commande crédités',
      async () => {
        const res = await fetch(`${API}/v1/tenants/${TENANT}/loyalty/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const me = await res.json();
        return me.history.some(
          (h) => h.kind === 'earn' && h.label.includes(`n° ${number}`) && h.points > 0,
        );
      },
      60_000,
      3_000,
    );
    await member.getByRole('tab', { name: 'Avantages' }).click();
    await member.getByText(`Commande n° ${number}`).last().waitFor({ timeout: 30_000 });
    await sleep(1500);
    await shot(member, 'd6-points-credites');
    await page.context().close();
  });
  if (member) await member.context().close();
} finally {
  for (const c of cleanups.reverse())
    await c().catch((e) => console.log(`nettoyage : ${e.message}`));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis.`);
  process.exitCode = failed.length ? 1 : 0;
}
