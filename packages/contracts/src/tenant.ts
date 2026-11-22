import { z } from 'zod';

/** Sous-domaine d'une enseigne : minuscules, chiffres et tirets (même règle que la base). */
export const subdomainSchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'Sous-domaine invalide');

export const tenantThemeSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  mode: z.enum(['light', 'dark']),
  logoUrl: z.url({ protocol: /^https$/ }).nullable(),
  tagline: z.string().max(120).nullable(),
});

/** Réponse de GET /v1/tenants/{subdomain}/config. */
export const tenantConfigSchema = z.object({
  tenant: z.object({
    id: z.uuid(),
    name: z.string().min(1),
    subdomain: subdomainSchema,
  }),
  theme: tenantThemeSchema,
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type TenantThemeDto = z.infer<typeof tenantThemeSchema>;
