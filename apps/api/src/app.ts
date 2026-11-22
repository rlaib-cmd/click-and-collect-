import { Hono } from 'hono';
import { cents } from '@splash360/core';

/**
 * Serveur de la commande en ligne : création de commande, paiement Stripe,
 * webhooks et envoi à la caisse Splash360 (lots 3 à 5).
 */
export function createApp() {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({ status: 'ok', currency: 'EUR', zero: cents(0) }),
  );

  return app;
}
