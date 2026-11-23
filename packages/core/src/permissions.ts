/**
 * Rôles et droits du back-office (lot 13, ADR 0017). Une seule source de vérité :
 * l'API refuse ce que ce module refuse, le back-office n'affiche que ce qu'il autorise.
 */
export type StaffRole = 'super_admin' | 'tenant_admin' | 'manager' | 'staff';

/** Rôles qu'une enseigne attribue à ses comptes (le super-administrateur est Splash360). */
export type TenantRole = Exclude<StaffRole, 'super_admin'>;

export const TENANT_ROLES: readonly TenantRole[] = ['tenant_admin', 'manager', 'staff'];

export type Permission =
  /** Voir et faire avancer les commandes. */
  | 'orders'
  /** Rembourser une commande payée. */
  | 'orders.refund'
  /** Mettre un produit en pause, ou la commande en ligne d'un restaurant. */
  | 'menu.pause'
  /** Ordre et visibilité de la carte, rafraîchissement depuis Splash360. */
  | 'menu.manage'
  /** Horaires, modes, frais et paiement sur place des restaurants. */
  | 'restaurants.settings'
  /** Studio design : logo, couleurs, style, textes légaux. */
  | 'design'
  | 'promos'
  /** Administration du club fidélité (membres, points). */
  | 'loyalty'
  | 'dashboard'
  /** Fichier clients, export et effacement RGPD. */
  | 'customers'
  | 'audit'
  /** Paiement en ligne : compte Stripe de l'enseigne. */
  | 'payments'
  /** Inviter, changer le rôle ou retirer un compte. */
  | 'team'
  /** Console Splash360 : toutes les enseignes. */
  | 'platform';

export const PERMISSIONS: readonly Permission[] = [
  'orders',
  'orders.refund',
  'menu.pause',
  'menu.manage',
  'restaurants.settings',
  'design',
  'promos',
  'loyalty',
  'dashboard',
  'customers',
  'audit',
  'payments',
  'team',
  'platform',
];

const MANAGER: readonly Permission[] = [
  'orders',
  'orders.refund',
  'menu.pause',
  'menu.manage',
  'restaurants.settings',
  'design',
  'promos',
  'loyalty',
  'dashboard',
  'customers',
  'audit',
];

const GRANTS: Readonly<Record<StaffRole, ReadonlySet<Permission>>> = {
  super_admin: new Set(PERMISSIONS),
  tenant_admin: new Set([...MANAGER, 'payments', 'team']),
  manager: new Set(MANAGER),
  staff: new Set(['orders', 'menu.pause']),
};

export function can(role: StaffRole, permission: Permission): boolean {
  return GRANTS[role].has(permission);
}

/** Un équipier est cantonné à son restaurant ; les autres rôles voient toute l'enseigne. */
export function isRestaurantScoped(role: StaffRole): boolean {
  return role === 'staff';
}

/**
 * Qui peut attribuer quel rôle : le propriétaire et Splash360 gèrent l'équipe ; personne ne
 * crée de super-administrateur depuis une enseigne.
 */
export function canAssignRole(actor: StaffRole, target: TenantRole): boolean {
  return can(actor, 'team') && TENANT_ROLES.includes(target);
}

/** Un compte d'équipe doit être rattaché à un restaurant seulement s'il est équipier. */
export function roleNeedsRestaurant(role: TenantRole): boolean {
  return role === 'staff';
}
