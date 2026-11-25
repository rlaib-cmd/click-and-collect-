import { describe, expect, it } from 'vitest';
import {
  can,
  canAssignRole,
  isRestaurantScoped,
  PERMISSIONS,
  roleNeedsRestaurant,
  type Permission,
  type StaffRole,
} from './permissions';

/** Matrice attendue (cahier des charges, lot 13) : chaque case est vérifiée. */
const EXPECTED: Record<Permission, Record<StaffRole, boolean>> = {
  orders: { super_admin: true, tenant_admin: true, manager: true, staff: true },
  'orders.refund': { super_admin: true, tenant_admin: true, manager: true, staff: false },
  'menu.pause': { super_admin: true, tenant_admin: true, manager: true, staff: true },
  'menu.manage': { super_admin: true, tenant_admin: true, manager: true, staff: false },
  'restaurants.settings': { super_admin: true, tenant_admin: true, manager: true, staff: false },
  design: { super_admin: true, tenant_admin: true, manager: true, staff: false },
  promos: { super_admin: true, tenant_admin: true, manager: true, staff: false },
  loyalty: { super_admin: true, tenant_admin: true, manager: true, staff: false },
  'loyalty.validate': { super_admin: true, tenant_admin: true, manager: false, staff: false },
  dashboard: { super_admin: true, tenant_admin: true, manager: true, staff: false },
  customers: { super_admin: true, tenant_admin: true, manager: true, staff: false },
  audit: { super_admin: true, tenant_admin: true, manager: true, staff: false },
  payments: { super_admin: true, tenant_admin: true, manager: false, staff: false },
  team: { super_admin: true, tenant_admin: true, manager: false, staff: false },
  platform: { super_admin: true, tenant_admin: false, manager: false, staff: false },
};

describe('droits du back-office', () => {
  it('couvre toutes les permissions', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    for (const role of ['super_admin', 'tenant_admin', 'manager', 'staff'] as const) {
      it(`${role} ${EXPECTED[permission][role] ? 'peut' : 'ne peut pas'} : ${permission}`, () => {
        expect(can(role, permission)).toBe(EXPECTED[permission][role]);
      });
    }
  }

  it('seul l’équipier est limité à son restaurant', () => {
    expect(isRestaurantScoped('staff')).toBe(true);
    expect(isRestaurantScoped('manager')).toBe(false);
    expect(isRestaurantScoped('tenant_admin')).toBe(false);
  });

  it('seuls le propriétaire et Splash360 attribuent des rôles', () => {
    expect(canAssignRole('tenant_admin', 'manager')).toBe(true);
    expect(canAssignRole('tenant_admin', 'tenant_admin')).toBe(true);
    expect(canAssignRole('super_admin', 'staff')).toBe(true);
    expect(canAssignRole('manager', 'staff')).toBe(false);
    expect(canAssignRole('staff', 'staff')).toBe(false);
  });

  it('un équipier doit avoir un restaurant, pas les autres', () => {
    expect(roleNeedsRestaurant('staff')).toBe(true);
    expect(roleNeedsRestaurant('manager')).toBe(false);
    expect(roleNeedsRestaurant('tenant_admin')).toBe(false);
  });
});
