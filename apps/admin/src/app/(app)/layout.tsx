'use client';

import { tenantSummarySchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { SessionProvider, useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin;

const NAV: { href: string; label: string; roles: readonly string[] }[] = [
  { href: '/commandes', label: t.nav.orders, roles: ['super_admin', 'tenant_admin', 'staff'] },
  { href: '/tableau-de-bord', label: t.nav.dashboard, roles: ['super_admin', 'tenant_admin'] },
  { href: '/carte', label: t.nav.menu, roles: ['super_admin', 'tenant_admin'] },
  { href: '/reglages', label: t.nav.settings, roles: ['super_admin', 'tenant_admin'] },
  { href: '/design', label: t.nav.design, roles: ['super_admin', 'tenant_admin'] },
  { href: '/paiement', label: t.nav.payments, roles: ['super_admin', 'tenant_admin'] },
  { href: '/clients', label: t.nav.customers, roles: ['super_admin', 'tenant_admin'] },
  { href: '/club', label: t.nav.club, roles: ['super_admin', 'tenant_admin'] },
  { href: '/equipe', label: t.nav.team, roles: ['super_admin', 'tenant_admin'] },
  { href: '/journal', label: t.nav.audit, roles: ['super_admin', 'tenant_admin'] },
];

function TenantSwitcher() {
  const { setTenant, auth } = useSession();
  const tenants = useApi('/tenants', z.object({ tenants: z.array(tenantSummarySchema) }));
  return (
    <select
      aria-label={t.common.chooseTenant}
      value={auth.tenantId ?? ''}
      onChange={(e) => setTenant(e.target.value || null)}
    >
      <option value="">{t.common.chooseTenant}</option>
      {tenants.data?.tenants.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const path = usePathname();
  const superAdmin = me.role === 'super_admin';
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Navigation principale">
        <strong className="brand">{me.tenant?.name ?? 'Splash360'}</strong>
        {superAdmin ? <TenantSwitcher /> : null}
        <ul>
          {superAdmin ? (
            <li>
              <Link href="/enseignes" aria-current={path === '/enseignes' ? 'page' : undefined}>
                {t.nav.tenants}
              </Link>
            </li>
          ) : null}
          {NAV.filter((n) => n.roles.includes(me.role)).map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={path === n.href ? 'page' : undefined}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="me">
          <span className="muted">{me.email}</span>
          <button type="button" className="link" onClick={() => void logout()}>
            {t.nav.logout}
          </button>
        </div>
      </nav>
      <main className="content">
        {superAdmin && !me.tenant && path !== '/enseignes' ? (
          <p className="muted">{t.common.chooseTenant}</p>
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
