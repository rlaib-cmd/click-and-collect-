import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiRequestError } from '@/api/client';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { formatFrenchDate, maskFrenchDate, parseFrenchDate } from '@/loyalty/profile';
import { useTenant } from '@/tenant/TenantProvider';
import { titleStyle } from './brand';
import { PrimaryButton } from './ui';

const t = messages.profile;

/**
 * Profil du membre (lot 16) : prénom, e-mail et date de naissance, tous facultatifs.
 * `welcome` : écran « Fais connaissance » juste après l'inscription, avec « Passer ».
 */
export function ProfileForm({ welcome, onDone }: { welcome: boolean; onDone: () => void }) {
  const { palette, radii, style } = useTenant();
  const { member, updateProfile } = useLoyalty();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [birth, setBirth] = useState(formatFrenchDate(member?.birthDate ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!member) return null;

  const birthDate = parseFrenchDate(birth);
  const emailOk = email.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const nameOk = name.trim() === '' || name.trim().length >= 2;

  const submit = async () => {
    if (birthDate === 'invalid') {
      setError(t.invalidDate);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({
        // Prénom vidé : on garde celui du compte (il sert sur la carte et en caisse).
        ...(name.trim().length >= 2 ? { name: name.trim() } : {}),
        email: email.trim() || null,
        birthDate,
      });
      setSaved(true);
      if (welcome) onDone();
    } catch (e) {
      setError(e instanceof ApiRequestError && e.code === 'conflict' ? t.emailTaken : t.error);
    } finally {
      setBusy(false);
    }
  };

  const input = [
    styles.input,
    {
      borderColor: palette.border,
      color: palette.text,
      backgroundColor: palette.surface,
      borderRadius: radii.card,
    },
  ];
  return (
    <View style={styles.form}>
      <Text
        style={[styles.title, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {welcome ? t.title : t.menuTitle}
      </Text>
      <Text style={{ color: palette.textMuted, fontSize: 15 }}>
        {welcome ? t.intro : t.editIntro}
      </Text>

      <Text style={[styles.label, { color: palette.text }]}>{t.firstName}</Text>
      <TextInput
        accessibilityLabel={t.firstName}
        placeholder={t.firstName}
        placeholderTextColor={palette.textMuted}
        value={name}
        onChangeText={setName}
        autoComplete="given-name"
        style={input}
      />

      <Text style={[styles.label, { color: palette.text }]}>{t.email}</Text>
      <TextInput
        accessibilityLabel={t.email}
        accessibilityHint={t.emailHint}
        placeholder={t.email}
        placeholderTextColor={palette.textMuted}
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        style={input}
      />
      <Text style={[styles.hint, { color: palette.textMuted }]}>{t.emailHint}</Text>

      <Text style={[styles.label, { color: palette.text }]}>{t.birthDate}</Text>
      <TextInput
        accessibilityLabel={t.birthDate}
        accessibilityHint={t.birthDatePlaceholder}
        placeholder={t.birthDatePlaceholder}
        placeholderTextColor={palette.textMuted}
        value={birth}
        onChangeText={(v) => setBirth(maskFrenchDate(v))}
        autoComplete="birthdate-full"
        keyboardType="number-pad"
        maxLength={10}
        style={input}
      />
      <Text style={[styles.hint, { color: palette.textMuted }]}>{t.birthDateHint}</Text>

      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {saved && !welcome ? (
        <Text style={{ color: palette.text, fontWeight: '700' }} accessibilityRole="alert">
          {t.saved}
        </Text>
      ) : null}
      <PrimaryButton
        label={t.save}
        disabled={busy || !emailOk || !nameOk}
        onPress={() => void submit()}
      />
      {welcome ? (
        <Pressable accessibilityRole="button" onPress={onDone} style={styles.skip}>
          <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 16 }}>{t.skip}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 8, alignSelf: 'stretch' },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  label: { fontWeight: '700', marginTop: 6 },
  hint: { fontSize: 13 },
  input: { borderWidth: 1, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  skip: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
