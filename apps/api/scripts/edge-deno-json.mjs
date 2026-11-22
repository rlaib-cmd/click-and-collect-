/* global process */
// Carte d'import Deno de la fonction Supabase : mêmes versions que le monorepo (lockfile pnpm).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['.', '../../packages/db', '../../packages/contracts', '../../packages/api-menu'];
const version = (name) => {
  for (const root of roots) {
    try {
      return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'))
        .version;
    } catch {
      // paquet absent de cette racine
    }
  }
  throw new Error(`Version introuvable : ${name}`);
};
// postgres.js 4.x bloque ou coupe les connexions concurrentes sous le runtime Deno de Supabase
// (CONNECTION_CLOSED, requêtes sans réponse) ; la 3.4, celle de la documentation Supabase, est stable.
const OVERRIDES = { postgres: '3.4.7' };
const imports = Object.fromEntries(
  ['zod', 'stripe', 'postgres', 'jose'].map((n) => [n, `npm:${n}@${OVERRIDES[n] ?? version(n)}`]),
);
writeFileSync('dist/edge/deno.json', `${JSON.stringify({ imports }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(imports)}\n`);
