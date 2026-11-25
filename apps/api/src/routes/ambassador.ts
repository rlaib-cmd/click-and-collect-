import type { LoyaltyProvider } from '@splash360/api-loyalty';
import {
  ambassadorEntryRequestSchema,
  type AmbassadorConfig,
  type AmbassadorEntryDto,
} from '@splash360/contracts';
import type { AmbassadorEntry, AmbassadorStore, TenantWithTheme } from '@splash360/db';
import type { Context, Hono } from 'hono';
import { apiError } from '../errors';
import { verifyMemberToken } from '../loyalty/service';

type Env = { Variables: { tenant: TenantWithTheme } };

export interface AmbassadorRoutesDeps {
  readonly ambassador?: AmbassadorStore | undefined;
  readonly loyalty?: LoyaltyProvider | undefined;
  readonly tokenSecret: string;
}

const bearer = (c: Context) =>
  /^Bearer ([0-9a-f-]{36}_[A-Za-z0-9_-]{20,100})$/i.exec(c.req.header('Authorization') ?? '')?.[1];

export const toEntryDto = (e: AmbassadorEntry): AmbassadorEntryDto => ({
  id: e.id,
  status: e.status,
  ticketRef: e.ticketRef,
  bonusPoints: e.bonusPoints,
  createdAt: e.createdAt.toISOString(),
});

/**
 * Ambassadeur (lot 15, ADR 0019), monté sous /v1/tenants/:subdomain. Une participation est
 * enregistrée « en attente » ; aucun point n'est crédité ici (voir confirmAmbassadorEntry).
 * La photo reste sur l'appareil du client : rien n'est envoyé au serveur.
 */
export function registerAmbassadorRoutes(app: Hono<Env>, deps: AmbassadorRoutesDeps) {
  async function settings(c: Context<Env>) {
    if (!deps.ambassador || !deps.loyalty) return null;
    const s = await deps.ambassador.getSettings(c.get('tenant').id);
    return s.enabled && s.instagramHandle
      ? { instagramHandle: s.instagramHandle, bonusPoints: s.bonusPoints }
      : null;
  }

  app.get('/:subdomain/ambassador', async (c) => {
    const s = await settings(c);
    const body: AmbassadorConfig = s ? { enabled: true, ...s } : { enabled: false };
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(body);
  });

  app.get('/:subdomain/ambassador/entries', async (c) => {
    const tenant = c.get('tenant');
    const memberId = verifyMemberToken(deps.tokenSecret, tenant.id, bearer(c));
    if (!memberId || !deps.ambassador)
      return apiError(c, 'unauthorized', 'Connexion au club requise');
    const entries = await deps.ambassador.memberEntries(tenant.id, memberId);
    c.header('Cache-Control', 'no-store');
    return c.json({ entries: entries.map(toEntryDto) });
  });

  app.post('/:subdomain/ambassador/entries', async (c) => {
    const tenant = c.get('tenant');
    const memberId = verifyMemberToken(deps.tokenSecret, tenant.id, bearer(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Connexion au club requise');
    const s = await settings(c);
    if (!s || !deps.ambassador || !deps.loyalty)
      return apiError(c, 'not_found', 'Programme ambassadeur indisponible');
    const parsed = ambassadorEntryRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError(c, 'invalid_request', parsed.error.issues[0]?.message ?? 'Saisie invalide');
    }
    const member = await deps.loyalty.getMember(
      { id: tenant.id, splash360Id: tenant.splash360Id },
      memberId,
    );
    if (!member) return apiError(c, 'unauthorized', 'Compte fidélité introuvable');
    const created = await deps.ambassador.createEntry({
      tenantId: tenant.id,
      memberId,
      ticketRef: parsed.data.ticketRef,
      instagramHandle: parsed.data.instagramHandle,
      bonusPoints: s.bonusPoints,
    });
    if (!created.ok) return apiError(c, 'conflict', 'Ce ticket a déjà servi pour une story');
    return c.json(toEntryDto(created.entry), 201);
  });
}
