import { messages } from '@splash360/i18n';
import { StyleSheet, Text, View } from 'react-native';
import { useAmbassador, useAmbassadorEntries } from '@/api/hooks';
import { titleStyle } from '@/components/brand';
import { stageLabel } from '@/lib/ambassador';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';
import { InstagramHandleField } from './InstagramHandleField';

const t = messages.ambassador;

/**
 * Compte → Ambassadeur (lot 17) : compte Instagram mémorisé (modifiable) et historique des
 * participations avec leur étape (« Mention reçue — +50 points le … »).
 */
export function AmbassadorAccountSection() {
  const { config, palette, style } = useTenant();
  const { memberToken } = useLoyalty();
  const program = useAmbassador();
  const entries = useAmbassadorEntries(memberToken);
  if (!program.data?.enabled || !memberToken) return null;
  const list = entries.data?.entries ?? [];
  return (
    <View style={styles.section}>
      <Text
        style={[styles.title, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.historyTitle}
      </Text>
      <InstagramHandleField memberToken={memberToken} />
      {list.length === 0 ? (
        <Text style={{ color: palette.textMuted }}>{t.historyEmpty}</Text>
      ) : (
        list.map((e) => (
          <View key={e.id} style={[styles.row, { borderColor: palette.border }]}>
            <Text style={{ color: palette.text, fontWeight: '700' }}>
              {t.historyTicket(e.ticketRef)} · {new Date(e.createdAt).toLocaleDateString('fr-FR')}
            </Text>
            <Text
              style={{
                color: e.stage === 'credited' ? palette.loyalty : palette.textMuted,
                fontWeight: e.stage === 'credited' ? '800' : '400',
              }}
            >
              {stageLabel(e, config.tenant.name)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 8 },
  title: { fontSize: 20, fontWeight: '900' },
  row: { gap: 2, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
