import { Redirect, router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileForm } from '@/components/ProfileForm';
import { BackButton, Loading } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

/** Compte → Mes informations (lot 16) : prénom, e-mail, date de naissance du membre. */
export default function MyInfoScreen() {
  const { palette } = useTenant();
  const { member, memberLoading } = useLoyalty();
  const insets = useSafeAreaInsets();
  if (memberLoading) return <Loading />;
  if (!member) return <Redirect href="/carte" />;
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      keyboardShouldPersistTaps="handled"
    >
      <BackButton />
      <ProfileForm welcome={false} onDone={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 120,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
});
