import {
  DEFAULT_PROXIMITY_RULES,
  PROXIMITY_ATTRIBUTION_HOURS,
  type ProximityDeepLink,
  type ProximityReason,
  type ProximityRules,
  type ProximityTarget,
} from '@splash360/core';
import { randomUUID } from 'node:crypto';
import type { Sql } from './client';

/**
 * Notifications « Bons plans à proximité » (lot 22, ADR 0027) : règles de l'enseigne, appareils
 * inscrits avec l'accord du membre, décisions d'envoi (sans position). Serveur uniquement.
 */
export type ProximityPlatform = 'ios' | 'android';
export type ProximityDecisionKind = 'sent' | 'skipped' | 'failed';

export interface ProximityCounts {
  readonly sent: number;
  readonly opened: number;
  /** Notifications suivies d'une commande du membre dans les 2 h. */
  readonly orders: number;
}

export interface ProximityStats {
  readonly last7Days: ProximityCounts;
  readonly last30Days: ProximityCounts;
  readonly optedInMembers: number;
}

export interface ProximityStore {
  /** Règles de l'enseigne ; défauts (désactivée) si jamais réglées. */
  getSettings(tenantId: string): Promise<ProximityRules>;
  saveSettings(tenantId: string, rules: ProximityRules): Promise<void>;
  /** Accord donné sur cet appareil ; un jeton déjà inscrit passe au membre connecté. */
  registerDevice(
    tenantId: string,
    memberId: string,
    token: string,
    platform: ProximityPlatform,
  ): Promise<void>;
  /** Retrait de l'accord : ce jeton, ou tous les appareils du membre (token null). */
  removeDevices(tenantId: string, memberId: string, token: string | null): Promise<number>;
  memberTokens(tenantId: string, memberId: string): Promise<string[]>;
  /** Dernières notifications envoyées au membre : tous restaurants, et pour celui-ci. */
  lastSent(
    tenantId: string,
    memberId: string,
    restaurantId: string,
  ): Promise<{ member: Date | null; restaurant: Date | null }>;
  /** Dernière commande validée du membre (payée, confirmée ou suite). */
  lastOrderAt(tenantId: string, memberId: string): Promise<Date | null>;
  /**
   * Réserve un envoi : enregistré seulement si aucun envoi au membre depuis `memberSince` ni pour
   * ce restaurant depuis `restaurantSince` (deux entrées simultanées : une seule notification).
   * Renvoie l'identifiant de l'événement, ou null si un plafond est atteint entre-temps.
   */
  claimSend(input: {
    tenantId: string;
    memberId: string;
    restaurantId: string;
    at: Date;
    memberSince: Date;
    restaurantSince: Date;
  }): Promise<string | null>;
  recordSkipped(input: {
    tenantId: string;
    memberId: string;
    restaurantId: string;
    reason: Exclude<ProximityReason, 'sent'>;
    at: Date;
  }): Promise<void>;
  /** Envoi Expo en échec : l'événement ne compte plus dans les plafonds. */
  markFailed(tenantId: string, eventId: string): Promise<void>;
  /** Notification ouverte par ce membre ; faux si inconnue, d'un autre membre ou déjà ouverte. */
  markOpened(tenantId: string, memberId: string, eventId: string, at: Date): Promise<boolean>;
  stats(tenantId: string, now: Date): Promise<ProximityStats>;
  /** Supprime les événements antérieurs à `before` (conservation 90 jours). */
  purge(before: Date): Promise<number>;
  /** Effacement RGPD d'un membre : appareils et événements. */
  forgetMember(tenantId: string, memberId: string): Promise<void>;
}

const DAY_MS = 86_400_000;
const ATTRIBUTION_MS = PROXIMITY_ATTRIBUTION_HOURS * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Statuts d'une commande validée (comptée pour l'inactivité et l'attribution). */
export const PROXIMITY_ORDER_STATUSES = [
  'paid',
  'confirmed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
] as const;

interface SettingsRow {
  enabled: boolean;
  radius_meters: number;
  title: string;
  body: string;
  deep_link: ProximityDeepLink;
  only_opening_hours: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  member_cap_hours: number;
  restaurant_cap_hours: number;
  target: ProximityTarget;
  inactive_days: number;
}

const hhmm = (t: string) => t.slice(0, 5);

function toRules(r: SettingsRow): ProximityRules {
  return {
    enabled: r.enabled,
    radiusMeters: r.radius_meters,
    title: r.title,
    body: r.body,
    deepLink: r.deep_link,
    onlyOpeningHours: r.only_opening_hours,
    quietHours:
      r.quiet_start && r.quiet_end ? { start: hhmm(r.quiet_start), end: hhmm(r.quiet_end) } : null,
    memberCapHours: r.member_cap_hours,
    restaurantCapHours: r.restaurant_cap_hours,
    target: r.target,
    inactiveDays: r.inactive_days,
  };
}

export function createPostgresProximityStore(sql: Sql): ProximityStore {
  async function counts(tenantId: string, since: Date): Promise<ProximityCounts> {
    const [r] = await sql<{ sent: number; opened: number; orders: number }[]>`
      select count(*)::int as sent,
             count(e.opened_at)::int as opened,
             count(*) filter (where exists (
               select 1 from public.orders o
               where o.tenant_id = e.tenant_id and o.loyalty_member_id = e.member_id
                 and o.created_at >= e.created_at
                 and o.created_at < e.created_at + ${`${ATTRIBUTION_MS} milliseconds`}::interval
                 and o.status in ${sql(PROXIMITY_ORDER_STATUSES)}))::int as orders
      from public.proximity_events e
      where e.tenant_id = ${tenantId} and e.decision = 'sent' and e.created_at >= ${since}`;
    return r ?? { sent: 0, opened: 0, orders: 0 };
  }

  return {
    async getSettings(tenantId) {
      const [r] = await sql<SettingsRow[]>`
        select * from public.proximity_settings where tenant_id = ${tenantId}`;
      return r ? toRules(r) : DEFAULT_PROXIMITY_RULES;
    },
    async saveSettings(tenantId, s) {
      await sql`
        insert into public.proximity_settings (
          tenant_id, enabled, radius_meters, title, body, deep_link, only_opening_hours,
          quiet_start, quiet_end, member_cap_hours, restaurant_cap_hours, target, inactive_days)
        values (
          ${tenantId}, ${s.enabled}, ${s.radiusMeters}, ${s.title}, ${s.body}, ${s.deepLink},
          ${s.onlyOpeningHours}, ${s.quietHours?.start ?? null}, ${s.quietHours?.end ?? null},
          ${s.memberCapHours}, ${s.restaurantCapHours}, ${s.target}, ${s.inactiveDays})
        on conflict (tenant_id) do update set
          enabled = excluded.enabled, radius_meters = excluded.radius_meters,
          title = excluded.title, body = excluded.body, deep_link = excluded.deep_link,
          only_opening_hours = excluded.only_opening_hours, quiet_start = excluded.quiet_start,
          quiet_end = excluded.quiet_end, member_cap_hours = excluded.member_cap_hours,
          restaurant_cap_hours = excluded.restaurant_cap_hours, target = excluded.target,
          inactive_days = excluded.inactive_days, updated_at = now()`;
    },
    async registerDevice(tenantId, memberId, token, platform) {
      await sql`
        insert into public.proximity_devices (tenant_id, expo_push_token, member_id, platform)
        values (${tenantId}, ${token}, ${memberId}, ${platform})
        on conflict (tenant_id, expo_push_token) do update set
          member_id = excluded.member_id, platform = excluded.platform, updated_at = now()`;
    },
    async removeDevices(tenantId, memberId, token) {
      const rows = token
        ? await sql`delete from public.proximity_devices
                    where tenant_id = ${tenantId} and member_id = ${memberId}
                      and expo_push_token = ${token} returning 1`
        : await sql`delete from public.proximity_devices
                    where tenant_id = ${tenantId} and member_id = ${memberId} returning 1`;
      return rows.length;
    },
    async memberTokens(tenantId, memberId) {
      const rows = await sql<{ expo_push_token: string }[]>`
        select expo_push_token from public.proximity_devices
        where tenant_id = ${tenantId} and member_id = ${memberId}
        order by updated_at desc limit 10`;
      return rows.map((r) => r.expo_push_token);
    },
    async lastSent(tenantId, memberId, restaurantId) {
      const [r] = await sql<{ member: Date | null; restaurant: Date | null }[]>`
        select max(created_at) as member,
               max(created_at) filter (where restaurant_id = ${restaurantId}) as restaurant
        from public.proximity_events
        where tenant_id = ${tenantId} and member_id = ${memberId} and decision = 'sent'`;
      return { member: r?.member ?? null, restaurant: r?.restaurant ?? null };
    },
    async lastOrderAt(tenantId, memberId) {
      const [r] = await sql<{ at: Date | null }[]>`
        select max(created_at) as at from public.orders
        where tenant_id = ${tenantId} and loyalty_member_id = ${memberId}
          and status in ${sql(PROXIMITY_ORDER_STATUSES)}`;
      return r?.at ?? null;
    },
    async claimSend(i) {
      return sql.begin(async (tx) => {
        // Verrou par membre : deux entrées simultanées sont traitées l'une après l'autre.
        await tx`select pg_advisory_xact_lock(hashtext(${`proximity:${i.tenantId}:${i.memberId}`}))`;
        const [busy] = await tx`
          select 1 from public.proximity_events
          where tenant_id = ${i.tenantId} and member_id = ${i.memberId} and decision = 'sent'
            and (created_at > ${i.memberSince}
                 or (restaurant_id = ${i.restaurantId} and created_at > ${i.restaurantSince}))
          limit 1`;
        if (busy) return null;
        const [row] = await tx<{ id: string }[]>`
          insert into public.proximity_events
            (tenant_id, member_id, restaurant_id, decision, reason, created_at)
          values (${i.tenantId}, ${i.memberId}, ${i.restaurantId}, 'sent', 'sent', ${i.at})
          returning id`;
        return row?.id ?? null;
      });
    },
    async recordSkipped(i) {
      await sql`
        insert into public.proximity_events
          (tenant_id, member_id, restaurant_id, decision, reason, created_at)
        values (${i.tenantId}, ${i.memberId}, ${i.restaurantId}, 'skipped', ${i.reason}, ${i.at})`;
    },
    async markFailed(tenantId, eventId) {
      if (!UUID.test(eventId)) return;
      await sql`update public.proximity_events set decision = 'failed', reason = 'push_failed'
                where tenant_id = ${tenantId} and id = ${eventId} and decision = 'sent'`;
    },
    async markOpened(tenantId, memberId, eventId, at) {
      if (!UUID.test(eventId)) return false;
      const rows = await sql`
        update public.proximity_events set opened_at = ${at}
        where tenant_id = ${tenantId} and id = ${eventId} and member_id = ${memberId}
          and decision = 'sent' and opened_at is null
        returning 1`;
      return rows.length > 0;
    },
    async stats(tenantId, now) {
      const [last7Days, last30Days, [members]] = await Promise.all([
        counts(tenantId, new Date(now.getTime() - 7 * DAY_MS)),
        counts(tenantId, new Date(now.getTime() - 30 * DAY_MS)),
        sql<{ n: number }[]>`
          select count(distinct member_id)::int as n from public.proximity_devices
          where tenant_id = ${tenantId}`,
      ]);
      return { last7Days, last30Days, optedInMembers: members?.n ?? 0 };
    },
    async purge(before) {
      const rows = await sql`delete from public.proximity_events where created_at < ${before}
                             returning 1`;
      return rows.length;
    },
    async forgetMember(tenantId, memberId) {
      await sql`delete from public.proximity_devices
                where tenant_id = ${tenantId} and member_id = ${memberId}`;
      await sql`delete from public.proximity_events
                where tenant_id = ${tenantId} and member_id = ${memberId}`;
    },
  };
}

/** Commande vue par le magasin en mémoire (tests de l'API). */
export interface ProximityOrderView {
  readonly tenantId: string;
  readonly memberId: string | null;
  readonly status: string;
  readonly createdAt: Date;
}

interface MemoryEvent {
  id: string;
  tenantId: string;
  memberId: string;
  restaurantId: string;
  decision: ProximityDecisionKind;
  reason: ProximityReason | 'push_failed';
  createdAt: Date;
  openedAt: Date | null;
}

/** Même comportement que Postgres, pour les tests de l'API sans base. */
export function createMemoryProximityStore(orders: () => readonly ProximityOrderView[] = () => []) {
  const settings = new Map<string, ProximityRules>();
  const devices: {
    tenantId: string;
    memberId: string;
    token: string;
    platform: ProximityPlatform;
    updatedAt: number;
  }[] = [];
  const events: MemoryEvent[] = [];
  const counted = (status: string) =>
    (PROXIMITY_ORDER_STATUSES as readonly string[]).includes(status);
  const sentOf = (tenantId: string, memberId: string) =>
    events.filter(
      (e) => e.tenantId === tenantId && e.memberId === memberId && e.decision === 'sent',
    );
  const maxDate = (list: readonly MemoryEvent[]) =>
    list.reduce<Date | null>((m, e) => (!m || e.createdAt > m ? e.createdAt : m), null);
  let tick = 0;

  const counts = (tenantId: string, since: Date): ProximityCounts => {
    const sent = events.filter(
      (e) => e.tenantId === tenantId && e.decision === 'sent' && e.createdAt >= since,
    );
    return {
      sent: sent.length,
      opened: sent.filter((e) => e.openedAt).length,
      orders: sent.filter((e) =>
        orders().some(
          (o) =>
            o.tenantId === e.tenantId &&
            o.memberId === e.memberId &&
            counted(o.status) &&
            o.createdAt >= e.createdAt &&
            o.createdAt.getTime() < e.createdAt.getTime() + ATTRIBUTION_MS,
        ),
      ).length,
    };
  };

  const store: ProximityStore = {
    getSettings: (tenantId) => Promise.resolve(settings.get(tenantId) ?? DEFAULT_PROXIMITY_RULES),
    saveSettings(tenantId, rules) {
      settings.set(tenantId, rules);
      return Promise.resolve();
    },
    registerDevice(tenantId, memberId, token, platform) {
      const existing = devices.find((d) => d.tenantId === tenantId && d.token === token);
      if (existing) Object.assign(existing, { memberId, platform, updatedAt: ++tick });
      else devices.push({ tenantId, memberId, token, platform, updatedAt: ++tick });
      return Promise.resolve();
    },
    removeDevices(tenantId, memberId, token) {
      let n = 0;
      for (let i = devices.length - 1; i >= 0; i--) {
        const d = devices[i];
        if (
          d &&
          d.tenantId === tenantId &&
          d.memberId === memberId &&
          (!token || d.token === token)
        ) {
          devices.splice(i, 1);
          n += 1;
        }
      }
      return Promise.resolve(n);
    },
    memberTokens: (tenantId, memberId) =>
      Promise.resolve(
        devices
          .filter((d) => d.tenantId === tenantId && d.memberId === memberId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 10)
          .map((d) => d.token),
      ),
    lastSent(tenantId, memberId, restaurantId) {
      const sent = sentOf(tenantId, memberId);
      return Promise.resolve({
        member: maxDate(sent),
        restaurant: maxDate(sent.filter((e) => e.restaurantId === restaurantId)),
      });
    },
    lastOrderAt: (tenantId, memberId) =>
      Promise.resolve(
        orders()
          .filter((o) => o.tenantId === tenantId && o.memberId === memberId && counted(o.status))
          .reduce<Date | null>((m, o) => (!m || o.createdAt > m ? o.createdAt : m), null),
      ),
    claimSend(i) {
      const busy = sentOf(i.tenantId, i.memberId).some(
        (e) =>
          e.createdAt > i.memberSince ||
          (e.restaurantId === i.restaurantId && e.createdAt > i.restaurantSince),
      );
      if (busy) return Promise.resolve(null);
      const id = randomUUID();
      events.push({
        id,
        tenantId: i.tenantId,
        memberId: i.memberId,
        restaurantId: i.restaurantId,
        decision: 'sent',
        reason: 'sent',
        createdAt: i.at,
        openedAt: null,
      });
      return Promise.resolve(id);
    },
    recordSkipped(i) {
      events.push({
        id: randomUUID(),
        tenantId: i.tenantId,
        memberId: i.memberId,
        restaurantId: i.restaurantId,
        decision: 'skipped',
        reason: i.reason,
        createdAt: i.at,
        openedAt: null,
      });
      return Promise.resolve();
    },
    markFailed(tenantId, eventId) {
      const e = events.find((x) => x.tenantId === tenantId && x.id === eventId);
      if (e && e.decision === 'sent')
        Object.assign(e, { decision: 'failed', reason: 'push_failed' });
      return Promise.resolve();
    },
    markOpened(tenantId, memberId, eventId, at) {
      const e = events.find(
        (x) =>
          x.tenantId === tenantId &&
          x.id === eventId &&
          x.memberId === memberId &&
          x.decision === 'sent' &&
          !x.openedAt,
      );
      if (e) e.openedAt = at;
      return Promise.resolve(e !== undefined);
    },
    stats: (tenantId, now) =>
      Promise.resolve({
        last7Days: counts(tenantId, new Date(now.getTime() - 7 * DAY_MS)),
        last30Days: counts(tenantId, new Date(now.getTime() - 30 * DAY_MS)),
        optedInMembers: new Set(
          devices.filter((d) => d.tenantId === tenantId).map((d) => d.memberId),
        ).size,
      }),
    purge(before) {
      const before0 = events.length;
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e && e.createdAt < before) events.splice(i, 1);
      }
      return Promise.resolve(before0 - events.length);
    },
    forgetMember(tenantId, memberId) {
      void store.removeDevices(tenantId, memberId, null);
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e && e.tenantId === tenantId && e.memberId === memberId) events.splice(i, 1);
      }
      return Promise.resolve();
    },
  };
  return { store, events, devices };
}
