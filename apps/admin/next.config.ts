import type { NextConfig } from 'next';

/**
 * ADMIN_STATIC_EXPORT=1 : export statique (aperçu hébergé sans serveur, ADR 0007).
 * Les pages sont toutes rendues côté navigateur et parlent à l'API ; seule la route
 * de connexion de développement (`route.ts`) est serveur, et elle est exclue de l'export.
 */
const staticExport = process.env.ADMIN_STATIC_EXPORT === '1';

const nextConfig: NextConfig = {
  // Les paquets internes sont publiés en TypeScript source.
  transpilePackages: [
    '@splash360/core',
    '@splash360/i18n',
    '@splash360/theme',
    '@splash360/contracts',
  ],
  ...(staticExport ? { output: 'export', pageExtensions: ['tsx'] } : {}),
};

export default nextConfig;
