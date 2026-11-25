import AsyncStorage from '@react-native-async-storage/async-storage';
import { proximityRegionsSchema } from '@splash360/contracts';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { API_URL, apiGet } from '@/api/client';
import { getPushToken } from '@/notifications/register';
import {
  geofenceRegions,
  parseProximityState,
  PROXIMITY_STATE_KEY,
  proximityLinkPath,
  readProximityPush,
  type ProximityState,
} from './regions';

/**
 * « Bons plans à proximité » sur iOS et Android (lot 22, ADR 0027). Le système surveille au plus
 * 20 zones autour des restaurants ; à l'entrée dans l'une d'elles, la tâche ci-dessous prévient
 * l'API, qui décide seule d'envoyer une notification. Aucune position n'est envoyée.
 */
export const PROXIMITY_TASK = 'splash360-bons-plans-proximite';

export const proximitySupported = true;

export type EnableResult =
  | 'enabled'
  | 'notifications_denied'
  | 'location_denied'
  | 'background_denied'
  | 'disabled_by_tenant'
  | 'unavailable'
  | 'error';

interface GeofencingTaskData {
  readonly eventType: Location.GeofencingEventType;
  readonly region: Location.LocationRegion;
}

const authHeaders = (memberToken: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${memberToken}`,
});

const tenantPath = (state: Pick<ProximityState, 'subdomain'>, path: string) =>
  `${API_URL}/v1/tenants/${state.subdomain}/proximity${path}`;

async function readState(): Promise<ProximityState | null> {
  return parseProximityState(await AsyncStorage.getItem(PROXIMITY_STATE_KEY).catch(() => null));
}

// Défini au chargement du module (portée globale), comme l'exige TaskManager : l'application
// peut être relancée en arrière-plan par le système pour cette seule tâche.
TaskManager.defineTask<GeofencingTaskData>(PROXIMITY_TASK, async ({ data, error }) => {
  if (error || data.eventType !== Location.GeofencingEventType.Enter) return;
  const restaurantId = data.region.identifier;
  if (!restaurantId) return;
  const state = await readState();
  if (!state) return;
  await fetch(tenantPath(state, '/enter'), {
    method: 'POST',
    headers: authHeaders(state.memberToken),
    body: JSON.stringify({ restaurantId }),
  }).catch(() => undefined);
});

async function stopGeofencing() {
  if (await Location.hasStartedGeofencingAsync(PROXIMITY_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(PROXIMITY_TASK).catch(() => undefined);
  }
}

/** Récupère les zones et (re)lance la surveillance ; faux si l'enseigne a coupé la fonction. */
async function startRegions(subdomain: string, memberToken: string): Promise<boolean> {
  const dto = await apiGet(
    `/v1/tenants/${subdomain}/proximity`,
    proximityRegionsSchema,
    (i, init) => fetch(i, { ...init, headers: authHeaders(memberToken) }),
  );
  const last = await Location.getLastKnownPositionAsync().catch(() => null);
  const regions = geofenceRegions(dto, last ? last.coords : null);
  if (regions.length === 0) {
    await stopGeofencing();
    return dto.enabled;
  }
  await Location.startGeofencingAsync(PROXIMITY_TASK, [...regions]);
  return true;
}

export async function isProximityOn(subdomain: string): Promise<boolean> {
  return (await readState())?.subdomain === subdomain;
}

/**
 * Active la fonction après l'accord explicite du membre : notifications, position « toujours »,
 * inscription de l'appareil, puis surveillance des zones. Chaque refus est rendu tel quel, sans
 * redemander : l'écran explique comment l'autoriser dans les réglages.
 */
export async function enableProximity(
  subdomain: string,
  memberToken: string,
): Promise<EnableResult> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return 'unavailable';
    const pushToken = await getPushToken();
    if (!pushToken) return 'notifications_denied';
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return 'location_denied';
    const background = await Location.requestBackgroundPermissionsAsync();
    if (!background.granted) return 'background_denied';
    const res = await fetch(tenantPath({ subdomain }, '/device'), {
      method: 'PUT',
      headers: authHeaders(memberToken),
      body: JSON.stringify({
        token: pushToken,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });
    if (!res.ok) return 'error';
    const state: ProximityState = { subdomain, memberToken, pushToken };
    await AsyncStorage.setItem(PROXIMITY_STATE_KEY, JSON.stringify(state));
    if (!(await startRegions(subdomain, memberToken))) return 'disabled_by_tenant';
    return 'enabled';
  } catch {
    return 'error';
  }
}

/** Retire l'accord : surveillance arrêtée, appareil effacé côté serveur, état local supprimé. */
export async function disableProximity(): Promise<void> {
  const state = await readState();
  await stopGeofencing();
  if (state) {
    await fetch(tenantPath(state, '/opt-out'), {
      method: 'POST',
      headers: authHeaders(state.memberToken),
      body: JSON.stringify({ token: state.pushToken }),
    }).catch(() => undefined);
  }
  await AsyncStorage.removeItem(PROXIMITY_STATE_KEY).catch(() => undefined);
}

/**
 * Au démarrage : met à jour les zones (restaurants ajoutés, rayon changé) et la session du membre.
 * Position « toujours » retirée dans les réglages du téléphone : l'accord est retiré aussi.
 */
export async function refreshProximity(subdomain: string, memberToken: string): Promise<void> {
  const state = await readState();
  if (!state || state.subdomain !== subdomain) return;
  const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (!background?.granted) {
    await disableProximity();
    return;
  }
  if (state.memberToken !== memberToken) {
    await AsyncStorage.setItem(PROXIMITY_STATE_KEY, JSON.stringify({ ...state, memberToken }));
  }
  await startRegions(subdomain, memberToken).catch(() => undefined);
}

/**
 * Toucher une notification « à proximité » : ouverture signalée à l'API (statistiques), puis
 * écran choisi par l'enseigne. Renvoie la fonction de désabonnement.
 */
export function subscribeProximityTaps(open: (path: '/' | '/commander' | '/avantages') => void) {
  const handled = new Set<string>();
  const handle = (response: Notifications.NotificationResponse | null) => {
    const push = readProximityPush(response?.notification.request.content.data);
    if (!push || handled.has(push.eventId)) return;
    handled.add(push.eventId);
    void readState().then((state) => {
      if (!state) return;
      return fetch(tenantPath(state, '/opened'), {
        method: 'POST',
        headers: authHeaders(state.memberToken),
        body: JSON.stringify({ eventId: push.eventId }),
      }).catch(() => undefined);
    });
    open(proximityLinkPath(push.link));
  };
  // Application lancée par le toucher : la réponse est déjà là.
  void Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
