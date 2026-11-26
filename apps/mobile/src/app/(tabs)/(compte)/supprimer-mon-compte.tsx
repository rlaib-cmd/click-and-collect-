import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { BackButton } from '@/components/ui';
import { deletionConsequences } from '@/loyalty/account-deletion';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.accountDeletion;

/** Rouge « action destructrice », contraste ≥ 4,5:1 avec le texte blanc, quel que soit le thème. */
const DESTRUCTIVE = '#B3261E';

/**
 * « Supprimer mon compte » (ADR 0028, App Store 5.1.1(v)) : conséquences expliquées, puis
 * confirmation explicite. Après la suppression : déconnexion, retour à l'accueil avec un message.
 */
export default function DeleteAccountScreen() {
  const { palette, style, radii } = useTenant();
  const { program, member, deleteAccount } = useLoyalty();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partner = program?.enabled === true && program.partnerErasure;

  const confirm = () => {
    setBusy(true);
    setError(null);
    deleteAccount()
      .then(() => router.replace('/'))
      .catch(() => {
        setError(t.error);
        setBusy(false);
      });
  };

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + 8, paddingBottom: TAB_BAR_CLEARANCE + insets.bottom },
      ]}
    >
      <BackButton color={palette.accent} />
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.title}
      </Text>
      <Text style={[styles.body, { color: palette.text }]}>{t.intro}</Text>
      <View
        style={[styles.box, { backgroundColor: palette.surface, borderRadius: radii.card + 4 }]}
      >
        {deletionConsequences(partner).map((line) => (
          <View key={line} style={styles.bullet}>
            <Text style={[styles.body, { color: palette.text }]} aria-hidden>
              •
            </Text>
            <Text style={[styles.body, styles.flex, { color: palette.text }]}>{line}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.body, styles.strong, { color: palette.text }]}>{t.irreversible}</Text>

      {error ? (
        <Text style={{ color: DESTRUCTIVE, textAlign: 'center' }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !member, busy }}
        disabled={busy || !member}
        onPress={confirm}
        style={({ pressed }) => [
          styles.destructive,
          {
            backgroundColor: member ? DESTRUCTIVE : palette.border,
            borderRadius: radii.button,
            opacity: pressed || busy ? 0.85 : 1,
          },
        ]}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.destructiveText}>{busy ? t.deleting : t.confirm}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => router.back()}
        style={styles.cancel}
      >
        <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 16 }}>{t.cancel}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 16,
    gap: 16,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  h1: { fontSize: 28, fontWeight: '900' },
  body: { fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: '700' },
  flex: { flex: 1 },
  box: { padding: 16, gap: 10 },
  bullet: { flexDirection: 'row', gap: 8 },
  destructive: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  destructiveText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, textAlign: 'center' },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
