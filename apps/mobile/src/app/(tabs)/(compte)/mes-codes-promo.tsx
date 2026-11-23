import { messages } from '@splash360/i18n';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { BackButton, PrimaryButton } from '@/components/ui';
import { listSavedPromos, removePromo, savePromo } from '@/orders/promos';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.promo;

/**
 * Mes codes promo (lot 11) : le client garde ici les codes reçus ; ils lui sont proposés au
 * récapitulatif. La validité est contrôlée par le serveur au moment du devis.
 */
export default function MyPromosScreen() {
  const { palette, style, radii, config } = useTenant();
  const insets = useSafeAreaInsets();
  const sub = config.tenant.subdomain;
  const [codes, setCodes] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSavedPromos(sub).then(setCodes);
  }, [sub]);

  const add = async () => {
    const code = await savePromo(sub, input);
    if (!code) return setError(t.invalidFormat);
    setError(null);
    setInput('');
    setCodes(await listSavedPromos(sub));
  };

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: TAB_BAR_CLEARANCE + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <BackButton color={palette.accent} />
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.myCodesTitle}
      </Text>
      <Text style={{ color: palette.textMuted }}>{t.myCodesHint}</Text>
      <View style={styles.row}>
        <TextInput
          value={input}
          onChangeText={(v) => setInput(v.toUpperCase())}
          placeholder={t.placeholder}
          placeholderTextColor={palette.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel={t.title}
          style={[
            styles.input,
            { borderColor: palette.border, color: palette.text, borderRadius: radii.button },
          ]}
        />
        <PrimaryButton label={t.save} onPress={() => void add()} style={styles.save} />
      </View>
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Text style={[styles.h2, { color: palette.text }]}>{t.saved}</Text>
      {codes.length === 0 ? <Text style={{ color: palette.textMuted }}>{t.none}</Text> : null}
      {codes.map((code) => (
        <View
          key={code}
          style={[styles.code, { backgroundColor: palette.surface, borderRadius: radii.card }]}
        >
          <Icon name="tag" color={palette.loyalty} size={22} />
          <Text style={[styles.codeText, { color: palette.text }]}>{code}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.remove} ${code}`}
            onPress={() =>
              void removePromo(sub, code)
                .then(() => listSavedPromos(sub))
                .then(setCodes)
            }
            style={styles.remove}
          >
            <Text style={{ color: palette.textMuted, fontWeight: '700' }}>{t.remove}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 26, fontWeight: '900' },
  h2: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    fontWeight: '700',
  },
  save: { minWidth: 120, flexShrink: 0 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  codeText: { flex: 1, fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  remove: { minHeight: 44, justifyContent: 'center' },
});
