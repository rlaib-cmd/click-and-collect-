import { Stack } from 'expo-router';
import { useTenant } from '@/tenant/TenantProvider';

/** L'onglet s'ouvre sur « Mon compte », même si l'on arrive par un lien profond. */
export const unstable_settings = { initialRouteName: 'compte' };

/**
 * Onglet Compte (lot 11) : profil, commandes, codes promo, moyens de paiement ; barre d'onglets
 * visible. Héberge aussi le parcours Ambassadeur (lot 15, `/ambassadeur`), ouvert depuis l'accueil
 * et Avantages : un écran hors onglet de la barre ne reste pas affiché dans le navigateur d'onglets.
 */
export default function AccountStack() {
  const { palette } = useTenant();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}
    >
      <Stack.Screen name="compte" />
    </Stack>
  );
}
