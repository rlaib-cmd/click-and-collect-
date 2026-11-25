import { messages } from '@splash360/i18n';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
import { BackButton, Loading } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import {
  disableProximity,
  enableProximity,
  isProximityOn,
  proximitySupported,
  type EnableResult,
} from '@/proximity/geofence';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.proximity;

const RESULT_TEXT: Record<Exclude<EnableResult, 'enabled'>, string> = {
  notifications_denied: t.notificationsDenied,
  location_denied: t.locationDenied,
  background_denied: t.backgroundDenied,
  disabled_by_tenant: t.disabledByTenant,
  unavailable: t.unavailable,
  error: t.error,
};

/** Résultats qui se corrigent dans les réglages du téléphone. */
const NEEDS_SETTINGS: readonly EnableResult[] = [
  'notifications_denied',
  'location_denied',
  'background_denied',
];

/**
 * Compte → Bons plans à proximité (lot 22, ADR 0027) : accord distinct, désactivé par défaut,
 * réservé aux membres du club, retirable à tout moment. Rien n'est demandé avant le geste du membre.
 */
export default function ProximityScreen() {
  const { palette, style } = useTenant();
  const { config } = useTenant();
  const { member, memberToken, memberLoading } = useLoyalty();
  const insets = useSafeAreaInsets();
  const sub = config.tenant.subdomain;
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'enabling' | 'disabling' | null>(null);
  const [problem, setProblem] = useState<Exclude<EnableResult, 'enabled'> | null>(null);

  useEffect(() => {
    void isProximityOn(sub).then(setOn);
  }, [sub]);

  if (memberLoading || on === null) return <Loading />;
  if (!member || !memberToken || !proximitySupported) return <Redirect href="/compte" />;

  const toggle = async (value: boolean) => {
    setProblem(null);
    if (value) {
      setBusy('enabling');
      const result = await enableProximity(sub, memberToken);
      setBusy(null);
      if (result === 'enabled') setOn(true);
      else {
        // Accord refusé quelque part : on n'insiste pas, l'état local est nettoyé.
        await disableProximity();
        setOn(false);
        setProblem(result);
      }
    } else {
      setBusy('disabling');
      await disableProximity();
      setBusy(null);
      setOn(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
    >
      <BackButton />
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.title}
      </Text>
      <Text style={[styles.p, { color: palette.text }]}>{t.intro}</Text>

      <View style={[styles.card, { borderColor: palette.border }]}>
        <View style={styles.row}>
          <Text style={[styles.toggle, { color: palette.text }]}>{t.toggle}</Text>
          <Switch
            value={on}
            disabled={busy !== null}
            onValueChange={(v) => void toggle(v)}
            accessibilityLabel={t.toggle}
          />
        </View>
        <Text style={{ color: palette.textMuted }} accessibilityLiveRegion="polite">
          {busy === 'enabling'
            ? t.enabling
            : busy === 'disabling'
              ? t.disabling
              : on
                ? t.on
                : t.off}
        </Text>
        {problem ? (
          <View style={styles.problem}>
            <Text style={{ color: palette.text }} accessibilityRole="alert">
              {RESULT_TEXT[problem]}
            </Text>
            {NEEDS_SETTINGS.includes(problem) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openSettings()}
                style={styles.link}
              >
                <Text style={{ color: palette.primary, fontWeight: '700' }}>{t.openSettings}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <Text style={[styles.h2, { color: palette.text }]}>{t.howTitle}</Text>
      {t.how.map((line) => (
        <Text key={line} style={[styles.p, { color: palette.text }]}>
          {`• ${line}`}
        </Text>
      ))}
      <Text style={[styles.h2, { color: palette.text }]}>{t.permissionsTitle}</Text>
      <Text style={[styles.p, { color: palette.textMuted }]}>{t.permissions}</Text>
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
  h1: { fontSize: 26, fontWeight: '900' },
  h2: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  p: { fontSize: 15, lineHeight: 21 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggle: { fontSize: 17, fontWeight: '700', flex: 1 },
  problem: { gap: 6 },
  link: { minHeight: 44, justifyContent: 'center' },
});
