import { can, type Permission, type StaffRole } from '@splash360/core';
import { messages } from '@splash360/i18n';
import type { IconName } from '@/components/Icon';

const t = messages.admin.nav;

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly permission: Permission;
}

/** Menu du studio, dans l'ordre de la maquette ; chaque entrée exige un droit (ADR 0017). */
export const NAV: readonly NavItem[] = [
  { href: '/accueil', label: t.home, icon: 'home', permission: 'design' },
  { href: '/commandes', label: t.orders, icon: 'orders', permission: 'orders' },
  { href: '/design', label: t.design, icon: 'palette', permission: 'design' },
  { href: '/carte', label: t.menu, icon: 'burger', permission: 'menu.pause' },
  { href: '/club', label: t.club, icon: 'gift', permission: 'loyalty' },
  { href: '/codes-promo', label: t.promos, icon: 'tag', permission: 'promos' },
  { href: '/bons-plans', label: t.proximity, icon: 'phone', permission: 'proximity' },
  { href: '/reglages', label: t.settings, icon: 'store', permission: 'restaurants.settings' },
  { href: '/tableau-de-bord', label: t.dashboard, icon: 'chart', permission: 'dashboard' },
  { href: '/clients', label: t.customers, icon: 'users', permission: 'customers' },
  { href: '/equipe', label: t.team, icon: 'team', permission: 'team' },
  { href: '/paiement', label: t.payments, icon: 'card', permission: 'payments' },
  { href: '/journal', label: t.audit, icon: 'journal', permission: 'audit' },
];

export function navFor(role: StaffRole): NavItem[] {
  return NAV.filter((n) => can(role, n.permission));
}

/** Page d'arrivée après connexion : l'accueil du studio, ou les commandes pour un équipier. */
export function homeFor(role: StaffRole): string {
  if (role === 'super_admin') return '/enseignes';
  return can(role, 'design') ? '/accueil' : '/commandes';
}
