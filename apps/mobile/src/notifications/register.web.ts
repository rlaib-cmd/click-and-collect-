/** Web : pas de notification push (le suivi se met à jour à l'écran). */
export function getPushToken(): Promise<string | null> {
  return Promise.resolve(null);
}
