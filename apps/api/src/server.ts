import { serve } from '@hono/node-server';
import { createPostgresTenantStore, createSql } from '@splash360/db';
import { createApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const sql = createSql(env.DATABASE_URL);
const origins = env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map((o) => o.trim());

const app = createApp({ tenants: createPostgresTenantStore(sql), corsOrigins: origins, log: true });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API Splash360 Commande à l'écoute sur http://localhost:${info.port}`);
});

function shutdown() {
  server.close();
  void sql.end({ timeout: 5 }).then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
