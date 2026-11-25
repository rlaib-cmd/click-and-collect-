/**
 * Web : pas de surveillance de zones en arrière-plan ni de notification push ; la fonction
 * « Bons plans à proximité » est masquée (lot 22, ADR 0027).
 */
export const PROXIMITY_TASK = 'splash360-bons-plans-proximite';
export const proximitySupported = false;

export type EnableResult =
  | 'enabled'
  | 'notifications_denied'
  | 'location_denied'
  | 'background_denied'
  | 'disabled_by_tenant'
  | 'unavailable'
  | 'error';

export const isProximityOn = (_subdomain: string) => Promise.resolve(false);
export const enableProximity = (_subdomain: string, _memberToken: string) =>
  Promise.resolve<EnableResult>('unavailable');
export const disableProximity = () => Promise.resolve();
export const refreshProximity = (_subdomain: string, _memberToken: string) => Promise.resolve();
export const subscribeProximityTaps =
  (_open: (path: '/' | '/commander' | '/avantages') => void) => () =>
    undefined;
