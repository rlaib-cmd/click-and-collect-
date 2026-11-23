import { Stack } from 'expo-router';
import { useTenant } from '@/tenant/TenantProvider';

/** L'onglet s'ouvre sur « Mon compte », même si l'on arrive par un lien profond. */
export const unstable_settings = { initialRouteName: 'compte' };

/** Onglet Compte (lot 11) : profil, commandes, codes promo, moyens de paiement ; barre d'onglets visible. */
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
