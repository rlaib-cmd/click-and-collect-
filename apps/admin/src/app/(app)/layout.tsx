'use client';

import { messages } from '@splash360/i18n';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { navFor } from '@/lib/nav';
import { SessionProvider, useSession } from '@/lib/session';

const t = messages.admin;

/** Tuile de marque : le logo de l'enseigne sur sa couleur (maquette du studio, lot 13). */
function BrandTile() {
  const { me } = useSession();
  const tenant = me.tenant;
  if (!tenant)
    return (
      <div className="brand-tile">
        <div className="tile" style={{ background: '#6366F1', color: '#fff' }}>
          S
        </div>
        <div>
          <strong>Splash360</strong>
          <span>{t.nav.console}</span>
        </div>
      </div>
    );
  return (
    <div className="brand-tile">
      <div className="tile" style={{ background: tenant.primaryColor, color: '#fff' }}>
        {tenant.logoUrl ? <img src={tenant.logoUrl} alt="" /> : tenant.name.charAt(0)}
      </div>
      <div>
        <strong>{tenant.name}</strong>
        <span>{t.nav.studio}</span>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, auth, logout, setTenant } = useSession();
  const router = useRouter();
  const path = (usePathname() || '/').replace(/\/+$/, '') || '/';
  const superAdmin = me.role === 'super_admin';
  const items = me.tenant || !superAdmin ? navFor(me.role) : [];
  const displayName = me.name ?? me.email;
  const needsTenant = superAdmin && !auth.tenantId && path !== '/enseignes';

  // Super-administrateur sans enseigne choisie : la console est son point d'entrée.
  useEffect(() => {
    if (needsTenant) router.replace('/enseignes');
  }, [needsTenant, router]);

  return (
    <div className="shell">
      {superAdmin && me.tenant ? (
        <div className="as-client" role="status">
          <Icon name="info" size={18} />
          <span>{t.console.asBanner(me.tenant.name)}</span>
          <button
            type="button"
            className="dark"
            style={{ borderColor: '#52525b' }}
            onClick={() => {
              setTenant(null);
              router.push('/enseignes');
            }}
          >
            {t.console.backToConsole}
          </button>
        </div>
      ) : null}
      <nav className="sidebar" aria-label={t.nav.label}>
        <BrandTile />
        <ul>
          {superAdmin ? (
            <li>
              <Link
                href="/enseignes"
                aria-current={path === '/enseignes' ? 'page' : undefined}
                onClick={() => setTenant(null)}
              >
                <Icon name="grid" />
                {t.nav.console}
              </Link>
            </li>
          ) : null}
          {items.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={path === n.href ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="me">
          <div className="avatar" aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{displayName}</strong>
            <span>
              {t.roles[me.role]}
              {me.tenant ? ` · ${me.tenant.name}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="ghost"
            aria-label={t.nav.logout}
            title={t.nav.logout}
            onClick={() => void logout()}
            style={{ padding: 8 }}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </nav>
      <main className="content">
        {needsTenant ? (
          <p className="banner info">
            {t.common.chooseTenant} · <Link href="/enseignes">{t.nav.console}</Link>
          </p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
