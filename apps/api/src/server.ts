import { serve } from '@hono/node-server';
import { createDemoMenuProvider, createMenuCache } from '@splash360/api-menu';
import {
  createPostgresOrderingStore,
  createPostgresRestaurantStore,
  createPostgresTenantStore,
  createSql,
} from '@splash360/db';
import { createApp } from './app';
import { loadEnv } from './env';
import { createBanGeoProvider, createDemoGeoProvider } from './geo';

const env = loadEnv();
const sql = createSql(env.DATABASE_URL);
const origins = env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map((o) => o.trim());

// En attendant la documentation de l'API menu Splash360 : cartes de démonstration.
const menus = createMenuCache(createDemoMenuProvider(), {
  ttlMs: env.MENU_CACHE_TTL_SECONDS * 1000,
  maxStaleMs: env.MENU_MAX_STALE_MINUTES * 60_000,
});

const app = createApp({
  tenants: createPostgresTenantStore(sql),
  restaurants: createPostgresRestaurantStore(sql),
  menus,
  ordering: createPostgresOrderingStore(sql),
  geo:
    env.GEOCODER_URL === 'demo' ? createDemoGeoProvider() : createBanGeoProvider(env.GEOCODER_URL),
  corsOrigins: origins,
  log: true,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API Splash360 Commande à l'écoute sur http://localhost:${info.port}`);
});

function shutdown() {
  server.close();
  void sql.end({ timeout: 5 }).then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
