import { Stack } from 'expo-router';
import { useTenant } from '@/tenant/TenantProvider';

/** L'onglet s'ouvre sur le choix du restaurant, même si l'on arrive par un lien profond. */
export const unstable_settings = { initialRouteName: 'commander' };

/**
 * Parcours de commande dans l'onglet Commander : carte, produit, panier, récapitulatif, suivi.
 * La barre d'onglets reste visible sur tous ces écrans ; le bouton retour remonte le parcours.
 */
export default function OrderingStack() {
  const { palette } = useTenant();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}
    >
      <Stack.Screen name="commander" />
      <Stack.Screen name="r/[restaurantId]/p/[productId]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
