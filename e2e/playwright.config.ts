import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours de bout en bout : l'API (port 8787) et l'application web (port 8081) doivent tourner,
 * sur une base migrée et chargée avec supabase/seed.sql (voir le job « e2e » de la CI).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_APP_URL ?? 'http://localhost:8081',
    ...devices['Pixel 7'],
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
});
