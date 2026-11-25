import { Buffer } from 'node:buffer';
import type { LoyaltyProvider } from '@splash360/api-loyalty';
import type { MenuCache } from '@splash360/api-menu';
import {
  ambassadorEntryRequestSchema,
  ambassadorProfileRequestSchema,
  photoCheckRequestSchema,
  ticketRefFromQr,
  MAX_PHOTO_BYTES,
  type AmbassadorConfig,
  type AmbassadorProfileDto,
  type PhotoCheckResponse,
} from '@splash360/contracts';
import type {
  AmbassadorEventInput,
  AmbassadorStore,
  MemberSessionStore,
  RestaurantStore,
  TenantWithTheme,
} from '@splash360/db';
import type { Context, Hono } from 'hono';
import { apiError } from '../errors';
import { CLIENT_ACTOR, toEntryDto } from '../loyalty/ambassador';
import {
  manualPhotoAnalyzer,
  photoCheckToken,
  readPhotoCheckToken,
  sniffImage,
  type PhotoAnalyzer,
} from '../loyalty/photo-check';
import { authenticateMember } from '../loyalty/service';

type Env = { Variables: { tenant: TenantWithTheme } };

export interface AmbassadorRoutesDeps {
  readonly ambassador?: AmbassadorStore | undefined;
  readonly loyalty?: LoyaltyProvider | undefined;
  readonly memberSessions?: MemberSessionStore | undefined;
  readonly tokenSecret: string;
  /** Analyse de la photo (lot 17) ; absente = vérification manuelle par l'équipe. */
  readonly photoAnalyzer?: PhotoAnalyzer | undefined;
  /** Carte de l'enseigne : noms des produits, contexte de l'analyse de la photo. */
  readonly restaurants: RestaurantStore;
  readonly menus: MenuCache;
  readonly now: () => Date;
}

const bearer = (c: Context) =>
  /^Bearer (m2\.[0-9a-f-]{36}\.[0-9a-z]{1,13}\.\d{1,6}\.[A-Za-z0-9_-]{20,100})$/i.exec(
    c.req.header('Authorization') ?? '',
  )?.[1];

/** Message du client quand la photo ne montre pas de produit de l'enseigne. */
export const photoRejectedMessage = (brand: string) =>
  `On ne voit pas de produit ${brand} sur ta photo…`;

/**
 * Ambassadeur (lots 15 et 17, ADR 0019 et 0022), monté sous /v1/tenants/:subdomain.
 * Une participation par achat (ticket) est enregistrée « en attente » ; les points ne sont
 * crédités qu'après la mention constatée et les délais de l'enseigne (processAmbassadorEntries).
 * La photo n'est envoyée que pour être analysée, puis oubliée : elle n'est jamais conservée.
 */
export function registerAmbassadorRoutes(app: Hono<Env>, deps: AmbassadorRoutesDeps) {
  const now = () => deps.now();

  async function settings(c: Context<Env>) {
    if (!deps.ambassador || !deps.loyalty) return null;
    const s = await deps.ambassador.getSettings(c.get('tenant').id);
    return s.enabled && s.instagramHandle ? { ...s, instagramHandle: s.instagramHandle } : null;
  }

  /** Membre connecté au club de l'enseigne courante, sinon null. */
  const member = (c: Context<Env>) => authenticateMember(deps, c.get('tenant').id, bearer(c));

  /** Noms des produits de la carte (premier restaurant ouvert) ; vide si la carte est indisponible. */
  async function productNames(tenantId: string): Promise<string[]> {
    try {
      const list = await deps.restaurants.listByTenant(tenantId);
      const restaurant = list.find((r) => r.status !== 'closed');
      if (!restaurant) return [];
      const cached = await deps.menus.get({
        restaurantId: restaurant.id,
        splash360RestaurantId: restaurant.splash360Id,
        live: restaurant.splash360Live,
      });
      return [...new Set(cached.menu.products.map((p) => p.name))];
    } catch {
      return [];
    }
  }

  app.get('/:subdomain/ambassador', async (c) => {
    const s = await settings(c);
    const body: AmbassadorConfig = s
      ? { enabled: true, instagramHandle: s.instagramHandle, bonusPoints: s.bonusPoints }
      : { enabled: false };
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(body);
  });

  app.get('/:subdomain/ambassador/profile', async (c) => {
    const memberId = await member(c);
    if (!memberId || !deps.ambassador)
      return apiError(c, 'unauthorized', 'Connexion au club requise');
    const body: AmbassadorProfileDto = {
      instagramHandle: await deps.ambassador.getProfile(c.get('tenant').id, memberId),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  app.put('/:subdomain/ambassador/profile', async (c) => {
    const memberId = await member(c);
    if (!memberId || !deps.ambassador)
      return apiError(c, 'unauthorized', 'Connexion au club requise');
    const parsed = ambassadorProfileRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return apiError(c, 'invalid_request', parsed.error.issues[0]?.message ?? 'Saisie invalide');
    await deps.ambassador.saveProfile(c.get('tenant').id, memberId, parsed.data.instagramHandle);
    const body: AmbassadorProfileDto = { instagramHandle: parsed.data.instagramHandle };
    return c.json(body);
  });

  app.post('/:subdomain/ambassador/photo-check', async (c) => {
    const tenant = c.get('tenant');
    const memberId = await member(c);
    if (!memberId) return apiError(c, 'unauthorized', 'Connexion au club requise');
    const s = await settings(c);
    if (!s) return apiError(c, 'not_found', 'Programme ambassadeur indisponible');
    const parsed = photoCheckRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return apiError(c, 'invalid_request', parsed.error.issues[0]?.message ?? 'Photo illisible');
    const data = new Uint8Array(Buffer.from(parsed.data.data, 'base64'));
    if (data.byteLength > MAX_PHOTO_BYTES)
      return apiError(c, 'payload_too_large', 'Photo trop lourde : 4 Mo maximum');
    const mediaType = sniffImage(data);
    if (!mediaType) return apiError(c, 'invalid_request', 'Format accepté : JPEG, PNG ou WebP');
    const analyzer = deps.photoAnalyzer ?? manualPhotoAnalyzer;
    const analysis = await analyzer.analyze(
      { data, mediaType },
      { brand: tenant.name, category: s.photoCategory, products: await productNames(tenant.id) },
    );
    const body: PhotoCheckResponse = {
      verdict: analysis.verdict,
      reason: analysis.verdict === 'rejected' ? photoRejectedMessage(tenant.name) : analysis.reason,
      token: photoCheckToken(deps.tokenSecret, tenant.id, memberId, analysis, now()),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  app.get('/:subdomain/ambassador/entries', async (c) => {
    const tenant = c.get('tenant');
    const memberId = await member(c);
    if (!memberId || !deps.ambassador)
      return apiError(c, 'unauthorized', 'Connexion au club requise');
    const entries = await deps.ambassador.memberEntries(tenant.id, memberId);
    c.header('Cache-Control', 'no-store');
    return c.json({ entries: entries.map(toEntryDto) });
  });

  app.post('/:subdomain/ambassador/entries', async (c) => {
    const tenant = c.get('tenant');
    const memberId = await member(c);
    if (!memberId) return apiError(c, 'unauthorized', 'Connexion au club requise');
    const s = await settings(c);
    if (!s || !deps.ambassador || !deps.loyalty)
      return apiError(c, 'not_found', 'Programme ambassadeur indisponible');
    const parsed = ambassadorEntryRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError(c, 'invalid_request', parsed.error.issues[0]?.message ?? 'Saisie invalide');
    }
    const loyaltyMember = await deps.loyalty.getMember(
      { id: tenant.id, splash360Id: tenant.splash360Id },
      memberId,
    );
    if (!loyaltyMember) return apiError(c, 'unauthorized', 'Compte fidélité introuvable');
    // Verdict de la photo : seulement celui que le serveur a signé pour ce membre.
    const photo = readPhotoCheckToken(
      deps.tokenSecret,
      tenant.id,
      memberId,
      parsed.data.photoCheck,
      now(),
    );
    if (photo?.verdict === 'rejected')
      return apiError(c, 'invalid_request', photoRejectedMessage(tenant.name));
    // QR scanné : la référence est recalculée ici à partir du contenu brut (pas de confiance au client).
    const ticketQr = parsed.data.ticketQr ?? null;
    const ticketRef = ticketQr ? ticketRefFromQr(ticketQr) : parsed.data.ticketRef;
    const handle = parsed.data.instagramHandle;
    const events: AmbassadorEventInput[] = [
      {
        type: 'created',
        actor: CLIENT_ACTOR,
        detail: { ticketRef, ticket: ticketQr ? 'scanné' : 'saisi', instagram: handle },
      },
      photo
        ? {
            type: 'photo_checked',
            actor: photo.analyzer,
            detail: { verdict: photo.verdict, reason: photo.reason },
          }
        : {
            type: 'photo_checked',
            actor: 'système',
            detail: { verdict: 'doubtful', reason: 'Photo non analysée' },
          },
    ];
    const created = await deps.ambassador.createEntry(
      {
        tenantId: tenant.id,
        memberId,
        ticketRef,
        ticketQr,
        instagramHandle: handle,
        bonusPoints: s.bonusPoints,
        photoVerdict: photo?.verdict ?? null,
        photoReason: photo?.reason ?? 'Photo non analysée',
        needsReview: photo?.verdict !== 'accepted',
      },
      events,
    );
    if (!created.ok) return apiError(c, 'conflict', 'Ce ticket a déjà servi pour une story');
    // Compte Instagram mémorisé : le client n'a plus à le ressaisir.
    await deps.ambassador.saveProfile(tenant.id, memberId, handle);
    return c.json(toEntryDto(created.entry), 201);
  });
}
