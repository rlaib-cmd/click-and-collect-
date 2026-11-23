import type { TenantSummaryDto } from '@splash360/contracts';

export type ConsoleState = 'live' | 'draft' | 'setup' | 'blocked';

/** État affiché dans la console Splash360 : bloquée, en configuration, brouillon en cours ou en ligne. */
export function tenantState(x: TenantSummaryDto): ConsoleState {
  if (x.status === 'suspended') return 'blocked';
  if (!x.ownerActive || x.restaurants === 0) return 'setup';
  return x.hasDraft ? 'draft' : 'live';
}
