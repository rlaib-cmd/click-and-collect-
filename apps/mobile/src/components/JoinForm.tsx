import { loyaltyJoinRequestSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ApiRequestError } from '@/api/client';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';
import { titleStyle } from './brand';
import { PrimaryButton } from './ui';

const t = messages.loyalty;

/** Adhésion au club (ou connexion de démonstration par e-mail). */
export function JoinForm() {
  const { palette, radii, style } = useTenant();
  const { program, join, login } = useLoyalty();
  const [mode, setMode] = useState<'join' | 'login'>('join');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!program?.enabled) return null;

  const joinInput = loyaltyJoinRequestSchema.safeParse({
    name,
    email: email.trim(),
    phone: phone.trim() || null,
    acceptedTerms: terms,
  });
  const loginOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'join' && joinInput.success) await join(joinInput.data);
      else if (mode === 'login') await login(email.trim());
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : null;
      setError(
        code === 'not_found'
          ? t.unknownEmail
          : code === 'conflict'
            ? t.emailTaken
            : messages.tenant.networkError,
      );
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
        {mode === 'join' ? t.joinTitle : t.loginTitle}
      </Text>
      {mode === 'join' ? (
        <Text style={{ color: palette.textMuted, fontSize: 15 }}>
          {t.joinIntro(program.welcomePoints)}
        </Text>
      ) : null}
      {mode === 'join' ? (
        <TextInput
          accessibilityLabel={t.name}
          placeholder={t.name}
          placeholderTextColor={palette.textMuted}
          value={name}
          onChangeText={setName}
          autoComplete="given-name"
          style={input}
        />
      ) : null}
      <TextInput
        accessibilityLabel={t.email}
        placeholder={t.email}
        placeholderTextColor={palette.textMuted}
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        style={input}
      />
      {mode === 'join' ? (
        <>
          <TextInput
            accessibilityLabel={t.phone}
            placeholder={t.phone}
            placeholderTextColor={palette.textMuted}
            value={phone}
            onChangeText={setPhone}
            autoComplete="tel"
            keyboardType="phone-pad"
            style={input}
          />
          <View style={styles.toggle}>
            <Switch value={terms} onValueChange={setTerms} accessibilityLabel={t.terms} />
            <Text style={{ color: palette.text, flex: 1 }}>{t.terms}</Text>
          </View>
          <Pressable accessibilityRole="link" onPress={() => router.push('/legal')}>
            <Text style={{ color: palette.accent, textDecorationLine: 'underline' }}>
              {t.legal}
            </Text>
          </Pressable>
        </>
      ) : null}
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={mode === 'join' ? t.submitJoin : t.login}
        disabled={busy || (mode === 'join' ? !joinInput.success : !loginOk)}
        onPress={() => void submit()}
      />
      {program.demo ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setMode(mode === 'join' ? 'login' : 'join');
            setError(null);
          }}
          style={styles.switch}
        >
          <Text style={{ color: palette.accent, fontWeight: '600' }}>
            {mode === 'join' ? t.haveAccount : t.noAccount}
          </Text>
        </Pressable>
      ) : null}
      {program.demo ? (
        <Text style={{ color: palette.textMuted, fontSize: 13 }}>{t.demoNotice}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, alignSelf: 'stretch' },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  input: { borderWidth: 1, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  switch: { minHeight: 44, justifyContent: 'center' },
});
