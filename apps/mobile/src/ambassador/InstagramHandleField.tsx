import { instagramHandleSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAmbassadorProfile, useSaveAmbassadorProfile } from '@/api/hooks';
import { displayHandle } from '@/lib/ambassador';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.ambassador;

/**
 * Compte Instagram du membre (lot 17) : saisi une fois et enregistré ; ensuite affiché dans une
 * case grisée (enregistré, non modifiable directement) avec « Modifier » à côté.
 */
export function InstagramHandleField({ memberToken }: { memberToken: string | null }) {
  const { palette } = useTenant();
  const profile = useAmbassadorProfile(memberToken);
  const save = useSaveAmbassadorProfile(memberToken);
  const saved = profile.data?.instagramHandle ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locked = saved !== null && !editing;

  const submit = () => {
    const parsed = instagramHandleSchema.safeParse(draft);
    if (!parsed.success) return setError(t.invalidHandle);
    setError(null);
    save.mutate(parsed.data, {
      onSuccess: () => setEditing(false),
      onError: () => setError(t.error),
    });
  };

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: palette.text, fontWeight: '700' }}>{t.yourInstagram}</Text>
      <View style={styles.row}>
        <TextInput
          value={locked ? displayHandle(saved) : draft}
          onChangeText={setDraft}
          editable={!locked}
          placeholder="@moncompte"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t.yourInstagram}
          accessibilityState={{ disabled: locked }}
          onSubmitEditing={submit}
          style={[
            styles.input,
            { borderColor: palette.border, color: locked ? palette.textMuted : palette.text },
            locked ? { backgroundColor: palette.surface } : null,
          ]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={save.isPending}
          onPress={() => {
            if (locked) {
              setDraft(saved);
              setEditing(true);
            } else submit();
          }}
          style={[styles.button, { borderColor: locked ? palette.border : palette.primary }]}
        >
          <Text style={{ color: palette.accent, fontWeight: '800' }}>
            {locked ? t.instagramEdit : t.instagramSave}
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: palette.textMuted, fontSize: 13 }}>
        {locked ? t.instagramSaved : t.yourInstagramHint}
      </Text>
      {error ? <Text style={{ color: palette.accent }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
});
