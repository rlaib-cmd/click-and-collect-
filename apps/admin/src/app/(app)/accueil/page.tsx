'use client';

import {
  adminRestaurantSchema,
  staffMemberSchema,
  themeDraftStateSchema,
} from '@splash360/contracts';
import { can } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { DEFAULT_THEME, themeChanges } from '@splash360/theme';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { z } from 'zod';
import { Icon, type IconName } from '@/components/Icon';
import { PhonePreview } from '@/components/PhonePreview';
import { homeFor } from '@/lib/nav';
import { usePreviewData } from '@/lib/preview-data';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.home;
const fields = messages.admin.design.fields;

const auditSchema = z.object({
  entries: z.array(z.object({ action: z.string(), at: z.string() }).loose()),
});

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

interface Tile {
  key: keyof typeof t.tiles;
  href: string;
  icon: IconName;
  bg: string;
  fg: string;
}

const TILES: (Tile & { permission: Parameters<typeof can>[1] })[] = [
  {
    key: 'design',
    href: '/design',
    icon: 'palette',
    bg: '#EEF0FF',
    fg: '#3730A3',
    permission: 'design',
  },
  {
    key: 'menu',
    href: '/carte',
    icon: 'pause',
    bg: '#FDECEC',
    fg: '#9F1239',
    permission: 'menu.pause',
  },
  {
    key: 'promos',
    href: '/codes-promo',
    icon: 'tag',
    bg: '#E8F5EC',
    fg: '#14532D',
    permission: 'promos',
  },
  { key: 'team', href: '/equipe', icon: 'team', bg: '#FFF4E5', fg: '#92400E', permission: 'team' },
  {
    key: 'orders',
    href: '/commandes',
    icon: 'orders',
    bg: '#F3F2EF',
    fg: '#17171C',
    permission: 'orders',
  },
];

/** Accueil du studio (maquette du lot 13) : état de l'application, raccourcis, mise en route. */
export default function HomePage() {
  const { me } = useSession();
  const router = useRouter();
  const allowed = can(me.role, 'design') && me.tenant !== null;

  useEffect(() => {
    if (!allowed) router.replace(homeFor(me.role));
  }, [allowed, me.role, router]);

  const theme = useApi(allowed ? '/theme/draft' : null, themeDraftStateSchema);
  const audit = useApi(allowed && can(me.role, 'audit') ? '/audit' : null, auditSchema);
  const restaurants = useApi(
    allowed ? '/restaurants' : null,
    z.object({ restaurants: z.array(adminRestaurantSchema) }),
  );
  const team = useApi(
    allowed && can(me.role, 'team') ? '/staff' : null,
    z.object({ staff: z.array(staffMemberSchema) }),
  );
  const preview = usePreviewData(me.tenant?.subdomain ?? null);

  if (!allowed || !me.tenant) return null;
  const tenant = me.tenant;
  const live = theme.data?.live ?? null;
  const pending =
    theme.data && theme.data.draft ? themeChanges(theme.data.live, theme.data.draft) : [];
  const publishedAt = audit.data?.entries.find((e) => e.action === 'theme.publish')?.at ?? null;
  const firstName = (me.name ?? me.email).split(/[\s(@]/)[0] ?? '';

  const setup = [
    { key: 'logo' as const, done: Boolean(live?.logoUrl), href: '/design' },
    {
      key: 'colors' as const,
      done: Boolean(live && live.primaryColor.toUpperCase() !== DEFAULT_THEME.primaryColor),
      href: '/design',
    },
    { key: 'menu' as const, done: (restaurants.data?.restaurants.length ?? 0) > 0, href: '/carte' },
    {
      key: 'payments' as const,
      done: restaurants.data?.restaurants.some((r) => r.stripeChargesEnabled) ?? false,
      href: can(me.role, 'payments') ? '/paiement' : null,
    },
    ...(can(me.role, 'team')
      ? [{ key: 'team' as const, done: (team.data?.staff.length ?? 0) > 1, href: '/equipe' }]
      : []),
  ];
  const done = setup.filter((s) => s.done).length;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h1>{t.hello(firstName)}</h1>
          <p>{t.intro(tenant.name)}</p>
        </div>
        {tenant.status === 'suspended' ? (
          <span className="pill danger">
            <span className="dot" />
            {t.suspended}
          </span>
        ) : (
          <span className="pill success">
            <span className="dot" />
            {t.online}
            {publishedAt ? ` · ${t.publishedOn(date(publishedAt))}` : ''}
          </span>
        )}
      </header>

      <div className="home">
        <div className="home-main">
          {pending.length > 0 ? (
            <div className="banner warning">
              <Icon name="edit" size={22} color="#92400E" />
              <div style={{ flex: '1 1 240px' }}>
                <strong>{t.draftTitle}</strong>
                <div style={{ fontSize: 14 }}>
                  {t.draftText(pending.map((f) => fields[f]).join(', '))}
                </div>
              </div>
              <Link href="/design" className="button dark">
                {t.resume}
              </Link>
            </div>
          ) : null}

          <section aria-labelledby="actions" className="stack" style={{ gap: 12 }}>
            <h2 id="actions" style={{ margin: 0 }}>
              {t.whatTitle}
            </h2>
            <div className="tiles">
              {TILES.filter((x) => can(me.role, x.permission))
                .slice(0, 4)
                .map((x) => (
                  <Link key={x.key} href={x.href} className="tile-link">
                    <span className="ico" style={{ background: x.bg }}>
                      <Icon name={x.icon} size={22} color={x.fg} />
                    </span>
                    <span>
                      <strong>{t.tiles[x.key][0]}</strong>
                      <span>{t.tiles[x.key][1]}</span>
                    </span>
                  </Link>
                ))}
            </div>
          </section>

          <section aria-labelledby="setup" className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h2 id="setup" style={{ margin: 0 }}>
                {t.setupTitle}
              </h2>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {t.setupProgress(done, setup.length)}
              </span>
            </div>
            <div className="progress" aria-hidden="true">
              <div style={{ width: `${Math.round((done / setup.length) * 100)}%` }} />
            </div>
            <ul className="checklist" style={{ marginTop: 10 }}>
              {setup.map((s) => {
                const [title, doneText, todoText] = t.setup[s.key];
                return (
                  <li key={s.key}>
                    <span className={`check ${s.done ? 'done' : 'todo'}`} aria-hidden="true">
                      {s.done ? <Icon name="check" size={14} color="#fff" stroke={3} /> : null}
                    </span>
                    <span style={{ flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: 14 }}>{title}</strong>
                      <span className="muted" style={{ fontSize: 13 }}>
                        {s.done ? doneText : todoText}
                      </span>
                    </span>
                    {!s.done && s.href ? (
                      <Link href={s.href} style={{ fontWeight: 700, fontSize: 14 }}>
                        {t.open} →
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="home-aside card" aria-label={t.appTitle}>
          <strong>{t.appTitle}</strong>
          {live ? (
            <PhonePreview theme={live} tenantName={tenant.name} data={preview} />
          ) : (
            <p className="muted">{messages.admin.common.loading}</p>
          )}
          <Link href="/design" className="button">
            {t.appCta}
          </Link>
        </aside>
      </div>
    </>
  );
}
