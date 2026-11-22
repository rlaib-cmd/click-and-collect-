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
const imports = Object.fromEntries(
  ['zod', 'stripe', 'postgres', 'jose'].map((n) => [n, `npm:${n}@${version(n)}`]),
);
writeFileSync('dist/edge/deno.json', `${JSON.stringify({ imports }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(imports)}\n`);
