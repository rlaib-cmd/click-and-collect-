import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import Stripe from 'stripe';

const API = process.env.E2E_API_URL ?? 'http://localhost:8787';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_e2e';

test('commande planifiée à emporter, payée par webhook Stripe, transmise à la caisse', async ({
  page,
}) => {
  // Les logos de démonstration sont hébergés à l'extérieur : sans réseau, le monogramme s'affiche.
  await page.route('https://placehold.co/**', (r) => r.abort());
  await page.route('https://js.stripe.com/**', (r) => r.abort());

  // Le restaurant encaisse par Stripe (compte connecté de test) : sinon le paiement par carte
  // n'est pas proposé au récapitulatif.
  const sql = postgres(DATABASE_URL, { max: 1 });
  await sql`update public.restaurants set stripe_account_id = 'acct_e2e', stripe_charges_enabled = true where splash360_id = 'S360-R-BELLA-1'`;

  // Accueil : à emporter, planifiée au premier créneau du premier jour proposé.
  await page.goto('/?enseigne=bella');
  await expect(page.getByRole('heading', { name: 'Pizzeria Bella' })).toBeVisible();
  await page.getByRole('button', { name: 'À emporter' }).click();
  await page.getByRole('radio', { name: 'Planifier' }).click();
  await page.getByRole('radio', { name: 'Demain' }).click();
  // Heure : liste déroulante (bas d'écran), premier créneau proposé.
  await page.getByText('Choisir l’heure').click();
  await page
    .getByRole('button', { name: /^\d{2}:\d{2}/ })
    .or(page.getByRole('radio', { name: /^\d{2}:\d{2}/ }))
    .first()
    .click();
  await page.getByRole('button', { name: 'Voir la carte' }).click();

  // Carte et fiche produit : l'option obligatoire bloque l'ajout.
  await page.getByText('Margherita').first().click();
  await expect(page.getByRole('button', { name: 'Choisissez : Taille' })).toBeDisabled();
  await page.getByText('Grande (40 cm)').click();
  await page.getByText('Burrata').click();
  await page.getByRole('button', { name: /Ajouter · 18,00/ }).click();

  // Panier puis récapitulatif calculé par le serveur.
  await page.getByRole('button', { name: /Voir le panier \(1\)/ }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Récapitulatif')).toBeVisible();
  await expect(page.getByText('18,00 €').last()).toBeVisible();
  await page.getByLabel('Nom').fill('Camille Martin');
  await page.getByLabel('Téléphone').fill('06 12 34 56 78');
  await page.getByLabel('E-mail').fill('camille.e2e@example.fr');
  await page.getByText("J'accepte les conditions générales de vente.").click();
  await expect(page.getByRole('radio', { name: /^Carte bancaire/ })).toBeChecked();
  await page.getByRole('button', { name: 'Commander et payer 18,00 €' }).click();

  // Commande créée, en attente de paiement.
  await expect(page.getByText(/Commande n° \d+/)).toBeVisible();
  await expect(page.getByText('En attente de paiement')).toBeVisible();
  const orderId = page.url().split('/order/')[1] ?? '';
  expect(orderId).toMatch(/^[0-9a-f-]{36}$/);

  // Le paiement est simulé côté Stripe : on rattache un PaymentIntent puis on envoie le webhook signé.
  try {
    await sql`update public.orders set stripe_payment_intent_id = ${`pi_e2e_${orderId}`} where id = ${orderId}`;
    const payload = JSON.stringify({
      id: `evt_e2e_${orderId}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      account: 'acct_e2e',
      data: {
        object: {
          id: `pi_e2e_${orderId}`,
          object: 'payment_intent',
          amount_received: 1800,
          currency: 'eur',
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const forged = await fetch(`${API}/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=faux' },
      body: payload,
    });
    expect(forged.status).toBe(400);
    const res = await fetch(`${API}/v1/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: payload,
    });
    expect(await res.json()).toEqual({ received: true, outcome: 'processed' });

    // L'application passe seule au suivi ; la commande est partie en caisse.
    await expect(page.getByText('Commande confirmée')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (await sql`select status from public.pos_dispatches where order_id = ${orderId}`)[0]
            ?.status,
        { timeout: 30_000 },
      )
      .toBe('sent');
  } finally {
    await sql.end();
  }
});
