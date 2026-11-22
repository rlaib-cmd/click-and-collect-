import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Les paquets internes sont publiés en TypeScript source.
  transpilePackages: ['@splash360/i18n', '@splash360/theme', '@splash360/contracts'],
};

export default nextConfig;
