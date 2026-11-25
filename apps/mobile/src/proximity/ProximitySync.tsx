import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';
import {
  disableProximity,
  proximitySupported,
  refreshProximity,
  subscribeProximityTaps,
} from './geofence';
import { parseProximityState, PROXIMITY_STATE_KEY, proximityAfterSession } from './regions';

/**
 * Suivi de l'accord « Bons plans à proximité » (lot 22) : zones mises à jour au démarrage,
 * accord retiré à la déconnexion (ou si un autre membre se connecte), toucher des notifications.
 */
export function ProximitySync() {
  const { config } = useTenant();
  const { memberToken, memberLoading } = useLoyalty();
  const sub = config.tenant.subdomain;

  useEffect(() => {
    if (!proximitySupported) return;
    return subscribeProximityTaps((path) => router.push(path));
  }, []);

  useEffect(() => {
    if (!proximitySupported || memberLoading) return;
    void AsyncStorage.getItem(PROXIMITY_STATE_KEY)
      .then((raw) => {
        const next = proximityAfterSession(parseProximityState(raw), {
          subdomain: sub,
          memberToken,
        });
        if (next === 'stop') return disableProximity();
        if (next === 'keep' && memberToken) return refreshProximity(sub, memberToken);
        return undefined;
      })
      .catch(() => undefined);
  }, [sub, memberToken, memberLoading]);

  return null;
}
